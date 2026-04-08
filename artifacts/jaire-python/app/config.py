from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    port: int = 8000
    debug: bool = False

    database_url: str = ""

    jaire_treasury_private_key: str = ""
    treasury_pubkey: str = "JDtjhBDwv3WwJpQR1LAcC9kTCwr4sbZhdEYVmKPcxRE"

    solana_network: str = "devnet"
    solana_rpc_url: str = "https://api.devnet.solana.com"

    web3auth_client_id: str = ""
    web3auth_node_factor_key: str = ""

    mpc_sidecar_url: str = "http://localhost:9000"

    openai_api_key: str = ""

    payment_provider: str = "paystack"
    paystack_secret_key: str = ""
    roqqu_webhook_secret: str = ""

    ngn_usdc_rate: float = 1600.0

    test_mode_enabled: bool = True

    class Config:
        env_file = ".env"
        extra = "ignore"
        case_sensitive = False


settings = Settings()
