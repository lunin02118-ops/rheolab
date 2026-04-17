import os
from pathlib import Path

import paramiko


DEPLOY_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = DEPLOY_DIR.parent.parent
DEFAULT_ENV_FILE = DEPLOY_DIR / ".env.server"
PROJECT_KNOWN_HOSTS = DEPLOY_DIR / "known_hosts"


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def load_deploy_env() -> None:
    env_override = os.environ.get("RHEOLAB_SERVER_ENV_FILE")
    if env_override:
        _load_env_file(Path(env_override))
    else:
        _load_env_file(DEFAULT_ENV_FILE)


load_deploy_env()

DEFAULT_TIMEOUT = float(os.environ.get("LICENSE_SERVER_SSH_TIMEOUT", "15"))
DEFAULT_KEY_PATH = os.path.expanduser(
    os.environ.get("LICENSE_SERVER_KEY_PATH", "~/.ssh/id_rsa")
)


def load_private_key(key_path: str):
    key_passphrase = os.environ.get("LICENSE_SERVER_KEY_PASSPHRASE")
    key_loaders = (
        paramiko.RSAKey,
        paramiko.Ed25519Key,
        paramiko.ECDSAKey,
    )

    last_error = None
    for loader in key_loaders:
        try:
            return loader.from_private_key_file(key_path, password=key_passphrase)
        except Exception as exc:  # pragma: no cover - auth fallback ladder
            last_error = exc

    raise RuntimeError(f"Unable to load SSH key {key_path}: {last_error}")


def require_license_server_env() -> tuple[str, str, str | None, str | None]:
    host = os.environ.get("LICENSE_SERVER_HOST")
    user = os.environ.get("LICENSE_SERVER_USER", "root")
    password = os.environ.get("LICENSE_SERVER_PASS")
    key_path = DEFAULT_KEY_PATH if os.path.exists(DEFAULT_KEY_PATH) else None

    missing = [
        name
        for name, value in (
            ("LICENSE_SERVER_HOST", host),
        )
        if not value
    ]

    if missing:
        raise RuntimeError(f"Set the required environment variables: {', '.join(missing)}")

    if not password and not key_path:
        raise RuntimeError(
            "Set LICENSE_SERVER_PASS or provide an SSH key via "
            "LICENSE_SERVER_KEY_PATH / ~/.ssh/id_rsa"
        )

    return host, user, password, key_path


def _build_ssh_client(*, allow_unknown_host: bool) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    if PROJECT_KNOWN_HOSTS.exists():
        try:
            client.load_host_keys(str(PROJECT_KNOWN_HOSTS))
        except Exception as exc:
            raise RuntimeError(f"Unable to load project known_hosts file {PROJECT_KNOWN_HOSTS}: {exc}") from exc
    client.set_missing_host_key_policy(
        paramiko.WarningPolicy() if allow_unknown_host else paramiko.RejectPolicy()
    )
    return client


def connect_license_server(
    timeout: float = DEFAULT_TIMEOUT,
    *,
    allow_unknown_host: bool | None = None,
) -> paramiko.SSHClient:
    host, user, password, key_path = require_license_server_env()
    if allow_unknown_host is None:
        allow_unknown_host = os.environ.get("LICENSE_SERVER_ALLOW_UNKNOWN_HOST") == "1"

    auth_attempts: list[tuple[str, dict[str, object | None]]] = []
    if key_path:
        auth_attempts.append(
            (
                f"SSH key ({key_path})",
                {
                    "password": None,
                    "pkey": load_private_key(key_path),
                },
            )
        )
    if password:
        auth_attempts.append(
            (
                "password",
                {
                    "password": password,
                    "pkey": None,
                },
            )
        )

    print(f"Connecting to {host}...")
    if not allow_unknown_host:
        print(
            "Host key verification: strict. Set LICENSE_SERVER_ALLOW_UNKNOWN_HOST=1 "
            "only for initial host bootstrap."
        )
    print("Authentication order: " + " -> ".join(label for label, _ in auth_attempts))

    errors: list[str] = []
    for label, auth_kwargs in auth_attempts:
        client = _build_ssh_client(allow_unknown_host=allow_unknown_host)
        try:
            client.connect(
                host,
                username=user,
                timeout=timeout,
                look_for_keys=False,
                allow_agent=False,
                password=auth_kwargs["password"],
                pkey=auth_kwargs["pkey"],
            )
            print(f"Connected using {label}")
            return client
        except Exception as exc:
            client.close()
            errors.append(f"{label}: {exc}")

    joined_errors = "; ".join(errors) if errors else "no authentication methods available"
    raise RuntimeError(f"Unable to connect to {host}. Tried: {joined_errors}")


def exec_checked(
    ssh: paramiko.SSHClient,
    cmd: str,
    *,
    stdin_data: str | None = None,
    print_command: bool = True,
) -> str:
    if print_command:
        print(f"\n$ {cmd}")

    stdin, stdout, stderr = ssh.exec_command(cmd)

    if stdin_data is not None:
        stdin.write(stdin_data)
        stdin.flush()
        stdin.channel.shutdown_write()

    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode()
    err = stderr.read().decode()

    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, end="" if err.endswith("\n") else "\n")

    if exit_status != 0:
        raise RuntimeError(f"Command failed with exit status {exit_status}: {cmd}")

    return out
