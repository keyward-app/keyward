//! Our own Bitwarden client.
//!
//! Own HTTP transport, complete vault models and Bitwarden cryptographic
//! formats over RustCrypto. Native and web clients share the protocol boundary
//! without depending on a third-party CLI's configuration or session model.

pub mod account;
pub mod client;
pub mod crypto;
pub mod folders;
pub mod identity;
pub mod login;
pub mod model;
pub mod orgs;
pub mod sync;

pub use model::Sync;
