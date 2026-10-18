use ring::{
    pbkdf2,
    rand::{SecureRandom, SystemRandom},
};
use std::num::NonZeroU32;

pub fn random_bytes(size: usize) -> Result<Vec<u8>, String> {
    let mut bytes = vec![0; size];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "系统随机数不可用".to_string())?;
    Ok(bytes)
}
pub fn valid_pin(pin: &str) -> bool {
    pin.len() == 4 && pin.bytes().all(|c| c.is_ascii_digit())
}
pub fn hash_pin(pin: &str) -> Result<(Vec<u8>, Vec<u8>), String> {
    if !valid_pin(pin) {
        return Err("PIN 必须为四位数字".into());
    }
    let salt = random_bytes(16)?;
    let mut hash = vec![0; 32];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(120_000).unwrap(),
        &salt,
        pin.as_bytes(),
        &mut hash,
    );
    Ok((salt, hash))
}
pub fn verify(pin: &str, salt: &[u8], hash: &[u8]) -> bool {
    valid_pin(pin)
        && hash.len() == 32
        && pbkdf2::verify(
            pbkdf2::PBKDF2_HMAC_SHA256,
            NonZeroU32::new(120_000).unwrap(),
            salt,
            pin.as_bytes(),
            hash,
        )
        .is_ok()
}
