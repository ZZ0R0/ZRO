/**
 * @zro/form — Form binding and validation module.
 *
 * Lightweight form binding utility. Define a schema with field rules,
 * bind it to a <form> element, and the module handles real-time
 * validation, error display, and submission via conn.invoke().
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
  ConnectionAPI,
} from '../core/types.js';

// ── Types ────────────────────────────────────────────────

export interface FieldRule {
  /** Whether the field is required. */
  required?: boolean;
  /** Minimum length. */
  minLength?: number;
  /** Maximum length. */
  maxLength?: number;
  /** Regex pattern to match. */
  pattern?: RegExp;
  /** Custom validation function. */
  validate?: (value: string) => string | null;
  /** Custom error messages. */
  messages?: {
    required?: string;
    minLength?: string;
    maxLength?: string;
    pattern?: string;
  };
}

export interface FormSchema {
  /** Field name → validation rules. */
  fields: Record<string, FieldRule>;
  /** Backend command to invoke on submit. */
  submit?: string;
  /** Custom submit handler (overrides invoke). */
  onSubmit?: (data: Record<string, string>) => void | Promise<void>;
  /** Error CSS class for invalid fields. Default: 'zro-field-error'. */
  errorClass?: string;
  /** CSS class for error messages. Default: 'zro-error-msg'. */
  errorMsgClass?: string;
}

export interface FormBinding {
  /** Validate all fields and return errors (empty = valid). */
  validate(): Record<string, string>;
  /** Get current form data. */
  getData(): Record<string, string>;
  /** Set form data programmatically. */
  setData(data: Record<string, string>): void;
  /** Reset the form. */
  reset(): void;
  /** Show a server error on a specific field. */
  setFieldError(field: string, message: string): void;
  /** Destroy the binding (remove listeners). */
  destroy(): void;
}

export interface FormAPI {
  /** Bind a form element with a schema. Returns a FormBinding. */
  bind(selector: string | HTMLFormElement, schema: FormSchema): FormBinding;
}

// ── Module factory ───────────────────────────────────────

export const formModule: ZroModuleFactory = () => {
  let _bindings: Array<() => void> = [];

  const mod: ZroModule = {
    meta: {
      name: 'form',
      version: '0.1.0',
      description: 'Form binding and validation',
      category: 'util',
      dependencies: [],
    },

    init(ctx: ZroModuleContext): FormAPI {
      const connection = ctx.hasModule('connection')
        ? ctx.getModule<ConnectionAPI>('connection')
        : null;

      function _validateField(value: string, rule: FieldRule): string | null {
        if (rule.required && !value.trim()) {
          return rule.messages?.required ?? 'This field is required';
        }
        if (rule.minLength && value.length < rule.minLength) {
          return rule.messages?.minLength ?? `Minimum ${rule.minLength} characters`;
        }
        if (rule.maxLength && value.length > rule.maxLength) {
          return rule.messages?.maxLength ?? `Maximum ${rule.maxLength} characters`;
        }
        if (rule.pattern && !rule.pattern.test(value)) {
          return rule.messages?.pattern ?? 'Invalid format';
        }
        if (rule.validate) {
          return rule.validate(value);
        }
        return null;
      }

      function _showError(input: HTMLElement, msg: string, errorClass: string, errorMsgClass: string): void {
        input.classList.add(errorClass);
        // Remove existing error message if any
        const existing = input.parentElement?.querySelector(`.${errorMsgClass}`);
        if (existing) existing.remove();
        // Add error message
        const errEl = document.createElement('span');
        errEl.className = errorMsgClass;
        errEl.textContent = msg;
        input.parentElement?.appendChild(errEl);
      }

      function _clearError(input: HTMLElement, errorClass: string, errorMsgClass: string): void {
        input.classList.remove(errorClass);
        const existing = input.parentElement?.querySelector(`.${errorMsgClass}`);
        if (existing) existing.remove();
      }

      const api: FormAPI = {
        bind(selector: string | HTMLFormElement, schema: FormSchema): FormBinding {
          const form = typeof selector === 'string'
            ? document.querySelector<HTMLFormElement>(selector)
            : selector;

          if (!form) {
            throw new Error(`[ZRO:form] Form not found: ${selector}`);
          }

          const errorClass = schema.errorClass ?? 'zro-field-error';
          const errorMsgClass = schema.errorMsgClass ?? 'zro-error-msg';
          const cleanups: Array<() => void> = [];

          // Attach input listeners for real-time validation
          for (const [fieldName, rule] of Object.entries(schema.fields)) {
            const input = form.elements.namedItem(fieldName) as HTMLInputElement | HTMLTextAreaElement | null;
            if (!input) continue;

            const handler = () => {
              const value = input.value;
              const error = _validateField(value, rule);
              if (error) {
                _showError(input, error, errorClass, errorMsgClass);
              } else {
                _clearError(input, errorClass, errorMsgClass);
              }
            };

            input.addEventListener('input', handler);
            cleanups.push(() => input.removeEventListener('input', handler));
          }

          // Attach submit handler
          const submitHandler = async (e: Event) => {
            e.preventDefault();
            const errors = binding.validate();

            if (Object.keys(errors).length > 0) return;

            const data = binding.getData();

            if (schema.onSubmit) {
              await schema.onSubmit(data);
            } else if (schema.submit && connection) {
              try {
                await connection.invoke(schema.submit, data);
              } catch (err) {
                // Show server error
                const message = err instanceof Error ? err.message : String(err);
                const errEl = form.querySelector(`.${errorMsgClass}[data-server-error]`)
                  || document.createElement('span');
                errEl.className = errorMsgClass;
                errEl.setAttribute('data-server-error', 'true');
                errEl.textContent = message;
                if (!errEl.parentElement) form.appendChild(errEl);
              }
            }
          };

          form.addEventListener('submit', submitHandler);
          cleanups.push(() => form.removeEventListener('submit', submitHandler));

          const binding: FormBinding = {
            validate(): Record<string, string> {
              const errors: Record<string, string> = {};
              for (const [fieldName, rule] of Object.entries(schema.fields)) {
                const input = form.elements.namedItem(fieldName) as HTMLInputElement | HTMLTextAreaElement | null;
                if (!input) continue;

                const error = _validateField(input.value, rule);
                if (error) {
                  errors[fieldName] = error;
                  _showError(input, error, errorClass, errorMsgClass);
                } else {
                  _clearError(input, errorClass, errorMsgClass);
                }
              }
              return errors;
            },

            getData(): Record<string, string> {
              const data: Record<string, string> = {};
              for (const fieldName of Object.keys(schema.fields)) {
                const input = form.elements.namedItem(fieldName) as HTMLInputElement | HTMLTextAreaElement | null;
                if (input) data[fieldName] = input.value;
              }
              return data;
            },

            setData(data: Record<string, string>): void {
              for (const [key, value] of Object.entries(data)) {
                const input = form.elements.namedItem(key) as HTMLInputElement | HTMLTextAreaElement | null;
                if (input) input.value = value;
              }
            },

            reset(): void {
              form.reset();
              for (const fieldName of Object.keys(schema.fields)) {
                const input = form.elements.namedItem(fieldName) as HTMLInputElement | HTMLTextAreaElement | null;
                if (input) _clearError(input, errorClass, errorMsgClass);
              }
              // Remove server errors
              const serverErr = form.querySelector(`[data-server-error]`);
              if (serverErr) serverErr.remove();
            },

            setFieldError(field: string, message: string): void {
              const input = form.elements.namedItem(field) as HTMLInputElement | HTMLTextAreaElement | null;
              if (input) _showError(input, message, errorClass, errorMsgClass);
            },

            destroy(): void {
              for (const fn of cleanups) fn();
              cleanups.length = 0;
            },
          };

          _bindings.push(binding.destroy);
          return binding;
        },
      };

      return api;
    },

    destroy(): void {
      for (const fn of _bindings) fn();
      _bindings = [];
    },
  };

  return mod;
};
