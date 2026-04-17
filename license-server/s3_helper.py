#!/usr/bin/env python3
import argparse
import os
import sys

import boto3
from botocore.config import Config


def require_env(name: str) -> str:
    value = os.environ.get(name, '').strip()
    if not value:
        raise SystemExit(f'Missing required environment variable: {name}')
    return value


def create_client():
    endpoint = require_env('S3_ENDPOINT')
    access_key = require_env('S3_ACCESS_KEY')
    secret_key = require_env('S3_SECRET_KEY')
    region = os.environ.get('S3_REGION', 'ru-1').strip() or 'ru-1'

    return boto3.client(
        's3',
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
        config=Config(signature_version='s3', s3={'addressing_style': 'virtual'}),
    )


def command_put(args):
    client = create_client()
    client.upload_file(args.source, args.bucket, args.key)


def command_get(args):
    client = create_client()
    client.download_file(args.bucket, args.key, args.target)


def command_delete(args):
    client = create_client()
    client.delete_object(Bucket=args.bucket, Key=args.key)


def command_list(args):
    client = create_client()
    paginator = client.get_paginator('list_objects_v2')

    for page in paginator.paginate(Bucket=args.bucket, Prefix=args.prefix):
        for item in page.get('Contents', []):
            timestamp = item['LastModified'].isoformat()
            print(f'{timestamp}\t{item["Key"]}')


def build_parser():
    parser = argparse.ArgumentParser(description='Beget S3 helper for license-server scripts.')
    subparsers = parser.add_subparsers(dest='command', required=True)

    put_parser = subparsers.add_parser('put')
    put_parser.add_argument('bucket')
    put_parser.add_argument('key')
    put_parser.add_argument('source')
    put_parser.set_defaults(func=command_put)

    get_parser = subparsers.add_parser('get')
    get_parser.add_argument('bucket')
    get_parser.add_argument('key')
    get_parser.add_argument('target')
    get_parser.set_defaults(func=command_get)

    delete_parser = subparsers.add_parser('delete')
    delete_parser.add_argument('bucket')
    delete_parser.add_argument('key')
    delete_parser.set_defaults(func=command_delete)

    list_parser = subparsers.add_parser('list')
    list_parser.add_argument('bucket')
    list_parser.add_argument('prefix')
    list_parser.set_defaults(func=command_list)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())