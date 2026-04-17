"""
Stable access utilities for the RheoLab deployment server.

Commands:
  python scripts/deploy/server_access.py doctor
  python scripts/deploy/server_access.py bootstrap-key
  python scripts/deploy/server_access.py refresh-known-hosts

The preferred steady-state access method is:
  1. project-local scripts/deploy/.env.server
  2. SSH key authentication
  3. strict host-key verification via scripts/deploy/known_hosts

Password authentication is kept only as a one-time bootstrap fallback.
"""

from __future__ import annotations

import argparse
import os
import socket
from pathlib import Path

import paramiko

from ssh_common import (
    DEFAULT_TIMEOUT,
    PROJECT_KNOWN_HOSTS,
    connect_license_server,
    exec_checked,
    load_deploy_env,
)


DEPLOY_DIR = Path(__file__).resolve().parent
DEFAULT_ENV_FILE = DEPLOY_DIR / ".env.server"


def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _resolve_key_path() -> Path:
    key_path = os.environ.get("LICENSE_SERVER_KEY_PATH")
    if not key_path:
        raise RuntimeError(
            "Set LICENSE_SERVER_KEY_PATH in scripts/deploy/.env.server or the environment."
        )
    return Path(os.path.expanduser(key_path)).resolve()


def ensure_keypair(key_path: Path, comment: str) -> tuple[Path, Path, str]:
    private_key = key_path
    public_key = key_path.with_suffix(key_path.suffix + ".pub" if key_path.suffix else ".pub")

    if private_key.exists() and public_key.exists():
        public_line = public_key.read_text(encoding="utf-8").strip()
        return private_key, public_key, public_line

    rsa_key = paramiko.RSAKey.generate(4096)
    rsa_key.write_private_key_file(str(private_key))
    public_line = f"{rsa_key.get_name()} {rsa_key.get_base64()} {comment}".strip()
    _write_text(public_key, public_line + "\n")
    return private_key, public_key, public_line


def _read_remote_authorized_keys(sftp: paramiko.SFTPClient, remote_path: str) -> str:
    try:
        with sftp.open(remote_path, "r") as handle:
            return handle.read().decode("utf-8")
    except FileNotFoundError:
        return ""


def bootstrap_key() -> None:
    load_deploy_env()
    key_path = _resolve_key_path()
    comment = os.environ.get("LICENSE_SERVER_KEY_COMMENT", "rheolab-deploy")
    private_key, public_key, public_line = ensure_keypair(key_path, comment)

    if not os.environ.get("LICENSE_SERVER_PASS"):
        raise RuntimeError(
            "Bootstrap requires LICENSE_SERVER_PASS for one-time password access. "
            "Set it only for this command, then remove it."
        )

    ssh = connect_license_server()
    sftp = ssh.open_sftp()
    try:
        exec_checked(ssh, "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys")
        remote_path = ".ssh/authorized_keys"
        current = _read_remote_authorized_keys(sftp, remote_path)

        if public_line not in current:
            updated = current.rstrip("\n")
            if updated:
                updated += "\n"
            updated += public_line + "\n"
            with sftp.open(remote_path, "w") as handle:
                handle.write(updated)
            print(f"Added deploy key to remote {remote_path}")
        else:
            print("Deploy key already present in remote authorized_keys")
    finally:
        sftp.close()
        ssh.close()

    # Verify key-based access immediately.
    previous_password = os.environ.pop("LICENSE_SERVER_PASS", None)
    try:
        ssh = connect_license_server()
        print(exec_checked(ssh, "echo key-auth-ok").strip())
        ssh.close()
    finally:
        if previous_password is not None:
            os.environ["LICENSE_SERVER_PASS"] = previous_password

    print(f"Private key: {private_key}")
    print(f"Public key: {public_key}")


def refresh_known_hosts() -> None:
    load_deploy_env()
    host = os.environ.get("LICENSE_SERVER_HOST")
    if not host:
        raise RuntimeError("LICENSE_SERVER_HOST is not configured")

    sock = socket.create_connection((host, 22), timeout=DEFAULT_TIMEOUT)
    transport = paramiko.Transport(sock)
    try:
        transport.start_client(timeout=DEFAULT_TIMEOUT)
        remote_key = transport.get_remote_server_key()
        entry = f"{host} {remote_key.get_name()} {remote_key.get_base64()}"
    finally:
        transport.close()
        sock.close()

    existing_lines = []
    if PROJECT_KNOWN_HOSTS.exists():
        existing_lines = PROJECT_KNOWN_HOSTS.read_text(encoding="utf-8").splitlines()

    preserved_comments = [line for line in existing_lines if line.startswith("#")]
    preserved_entries = [
        line
        for line in existing_lines
        if line.strip()
        and not line.startswith("#")
        and not line.startswith(f"{host} ")
    ]

    updated = preserved_comments[:]
    if updated and (preserved_entries or entry):
        updated.append("")
    updated.extend(preserved_entries)
    updated.append(entry)
    PROJECT_KNOWN_HOSTS.write_text("\n".join(updated).rstrip() + "\n", encoding="utf-8")
    print(f"Updated {PROJECT_KNOWN_HOSTS} with host key for {host}")


def doctor() -> None:
    load_deploy_env()
    ssh = connect_license_server()
    try:
        print(exec_checked(ssh, "hostname && whoami").strip())
        print(f"known_hosts file: {PROJECT_KNOWN_HOSTS}")
        print(f"env file: {DEFAULT_ENV_FILE}")
        print(f"auth mode: {'password' if os.environ.get('LICENSE_SERVER_PASS') else 'ssh-key'}")
    finally:
        ssh.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="RheoLab deployment server access helper")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("doctor", help="Verify server access using the configured method")
    subparsers.add_parser("bootstrap-key", help="Install the configured SSH public key on the server")
    subparsers.add_parser("refresh-known-hosts", help="Refresh scripts/deploy/known_hosts from the current server key")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "doctor":
        doctor()
    elif args.command == "bootstrap-key":
        bootstrap_key()
    elif args.command == "refresh-known-hosts":
        refresh_known_hosts()
    else:
        parser.error(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()
