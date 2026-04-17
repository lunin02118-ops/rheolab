import boto3
from botocore.client import Config
import os
import sys

ACCESS_KEY = os.environ.get("S3_ACCESS_KEY", "")
SECRET_KEY = os.environ.get("S3_SECRET_KEY", "")
ENDPOINT = os.environ.get("S3_ENDPOINT", "https://s3.ru1.storage.beget.cloud")
BUCKET = os.environ.get("S3_BUCKET", "67dfb2b63527-present-alya")

def main():
    if not ACCESS_KEY or not SECRET_KEY:
        print("Error: S3_ACCESS_KEY and S3_SECRET_KEY environment variables must be set.")
        sys.exit(1)

    session = boto3.session.Session()
    s3 = session.client(
        service_name='s3',
        endpoint_url=ENDPOINT,
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        config=Config(signature_version='s3v4')
    )

    try:
        print(f"Uploading hello.txt...")
        s3.put_object(
            Bucket=BUCKET,
            Key="hello.txt",
            Body=b"Hello World",
            ACL='public-read',
            ContentType='text/plain'
        )
        print("✅ Upload successful!")
    except Exception as e:
        print(f"❌ Upload failed: {e}")

if __name__ == "__main__":
    main()
