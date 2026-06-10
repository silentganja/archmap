use std::env;
use crate::utils::format_date;
use crate::utils::clamp;
use crate::models::user::User;

fn main() {
    let date = format_date("2024-01-01");
    let value = clamp(100, 0, 255);
    let user = User::new("Alice");
    println!("Date: {}, Value: {}, User: {}", date, value, user.name);
    let _args: Vec<String> = env::args().collect();
}
