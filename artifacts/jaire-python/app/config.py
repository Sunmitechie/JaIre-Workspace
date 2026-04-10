from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    port: int = 8000
    debug: bool = False

    database_url: str = ""

    # Solana
    jaire_treasury_private_key: str = ""
    treasury_pubkey: str = "JDtjhBDwv3WwJpQR1LAcC9kTCwr4sbZhdEYVmKPcxRE"
    solana_network: str = "devnet"
    solana_rpc_url: str = "https://api.devnet.solana.com"

    # JaIre Liquidity Vault
    jaire_vault_address: str = ""
    jaire_vault_private_key: str = ""

    # Web3Auth
    web3auth_client_id: str = ""
    web3auth_node_factor_key: str = ""
    mpc_sidecar_url: str = "http://localhost:9000"

    # AI
    openai_api_key: str = ""

    # Payment providers
    payment_provider: str = "paystack"
    paystack_secret_key: str = ""
    stripe_secret_key: str = ""
    roqqu_webhook_secret: str = ""
    stripe_webhook_secret: str = ""

    # Legacy fixed rate (oracle fallback only)
    ngn_usdc_rate: float = 1600.0

    test_mode_enabled: bool = True

    class Config:
        env_file = ".env"
        extra = "ignore"
        case_sensitive = False


settings = Settings()
