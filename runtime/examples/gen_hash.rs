use argon2::{Argon2, PasswordHasher};
use argon2::password_hash::SaltString;
use rand::rngs::OsRng;

fn main() {
    let password = std::env::args().nth(1).unwrap_or_else(|| "dev".to_string());
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2.hash_password(password.as_bytes(), &salt).unwrap();
    println!("{}", hash);
}
