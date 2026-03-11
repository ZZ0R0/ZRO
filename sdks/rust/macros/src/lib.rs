use proc_macro::TokenStream;
use quote::{quote, format_ident};
use syn::{parse_macro_input, FnArg, ItemFn, Pat, ReturnType, Type};

/// Attribute macro that transforms an async function into a ZRO command handler.
///
/// # Usage
///
/// ```rust,no_run,ignore
/// #[zro::command]
/// async fn greet(name: String, age: u32) -> Result<String, String> {
///     Ok(format!("Hello {}, you are {} years old!", name, age))
/// }
/// ```
///
/// The function parameters are automatically deserialized from the JSON `params` object
/// sent by the client `invoke("greet", { name: "Alice", age: 30 })`.
///
/// Special parameters:
/// - `ctx: CommandContext` — injected automatically, provides session info and event emitter
///
/// The return type must be `Result<T, String>` where `T: Serialize`.
#[proc_macro_attribute]
pub fn command(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let input_fn = parse_macro_input!(item as ItemFn);
    let fn_name = &input_fn.sig.ident;
    let fn_vis = &input_fn.vis;
    let fn_block = &input_fn.block;
    let fn_asyncness = &input_fn.sig.asyncness;

    if fn_asyncness.is_none() {
        return syn::Error::new_spanned(&input_fn.sig, "#[zro::command] requires an async fn")
            .to_compile_error()
            .into();
    }

    // Separate "special" params (CommandContext) from "data" params (deserialized from JSON)
    let mut has_ctx = false;
    let mut ctx_ident = format_ident!("_ctx");
    let mut data_params: Vec<(syn::Ident, Box<Type>)> = Vec::new();

    for arg in &input_fn.sig.inputs {
        match arg {
            FnArg::Typed(pat_type) => {
                let ident = match pat_type.pat.as_ref() {
                    Pat::Ident(pi) => pi.ident.clone(),
                    _ => {
                        return syn::Error::new_spanned(&pat_type.pat, "expected identifier")
                            .to_compile_error()
                            .into();
                    }
                };

                // Check if this is a CommandContext parameter
                if is_command_context_type(&pat_type.ty) {
                    has_ctx = true;
                    ctx_ident = ident;
                } else {
                    data_params.push((ident, pat_type.ty.clone()));
                }
            }
            FnArg::Receiver(_) => {
                return syn::Error::new_spanned(arg, "#[zro::command] does not support self")
                    .to_compile_error()
                    .into();
            }
        }
    }

    // Build the parameter extraction code
    let param_extractions: Vec<_> = data_params.iter().map(|(ident, ty)| {
        let name_str = ident.to_string();
        quote! {
            let #ident: #ty = {
                let __val = __params.get(#name_str).cloned()
                    .unwrap_or(::serde_json::Value::Null);
                ::serde_json::from_value(__val)
                    .map_err(|e| format!("param '{}': {}", #name_str, e))?
            };
        }
    }).collect();

    let param_idents: Vec<_> = data_params.iter().map(|(ident, _)| ident).collect();

    // Build the inner call with or without ctx
    let inner_call = if has_ctx {
        quote! { __inner_fn(#ctx_ident, #(#param_idents),*).await }
    } else {
        quote! { __inner_fn(#(#param_idents),*).await }
    };

    // Build the inner function signature
    let inner_params = &input_fn.sig.inputs;
    let inner_return = &input_fn.sig.output;

    // Determine the return type for serialization
    let serialize_result = match &input_fn.sig.output {
        ReturnType::Default => {
            // fn returns () — wrap in Ok(Value::Null)
            quote! {
                #inner_call;
                Ok(::serde_json::Value::Null)
            }
        }
        ReturnType::Type(_, ty) => {
            if is_result_type(ty) {
                // fn returns Result<T, E> — serialize the Ok value
                quote! {
                    let __result = #inner_call?;
                    ::serde_json::to_value(__result).map_err(|e| e.to_string())
                }
            } else {
                // fn returns T directly — serialize it
                quote! {
                    let __result = #inner_call;
                    ::serde_json::to_value(__result).map_err(|e| e.to_string())
                }
            }
        }
    };

    let ctx_param = if has_ctx {
        quote! { let #ctx_ident = __ctx; }
    } else {
        quote! { let _ = &__ctx; }
    };

    let wrapper_fn = quote! {
        #fn_vis fn #fn_name(
            __params: ::serde_json::Value,
            __ctx: ::zro_sdk::CommandContext,
        ) -> ::std::pin::Pin<Box<dyn ::std::future::Future<Output = ::std::result::Result<::serde_json::Value, String>> + Send + 'static>> {
            Box::pin(async move {
                // Inner function with the original signature
                async fn __inner_fn(#inner_params) #inner_return #fn_block

                // Extract parameters from JSON
                let __params = match __params.as_object() {
                    Some(obj) => ::serde_json::Value::Object(obj.clone()),
                    None => ::serde_json::Value::Object(::serde_json::Map::new()),
                };
                #(#param_extractions)*
                #ctx_param

                // Call the inner function and serialize the result
                #serialize_result
            })
        }
    };

    wrapper_fn.into()
}

/// Check if a type path ends with "CommandContext"
fn is_command_context_type(ty: &Type) -> bool {
    match ty {
        Type::Path(tp) => {
            tp.path.segments.last()
                .map(|seg| seg.ident == "CommandContext")
                .unwrap_or(false)
        }
        Type::Reference(r) => is_command_context_type(&r.elem),
        _ => false,
    }
}

/// Check if a type looks like Result<T, E>
fn is_result_type(ty: &Type) -> bool {
    match ty {
        Type::Path(tp) => {
            tp.path.segments.last()
                .map(|seg| seg.ident == "Result")
                .unwrap_or(false)
        }
        _ => false,
    }
}
