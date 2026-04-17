import boto3
from botocore.client import Config
import os
import sys

ACCESS_KEY = os.environ.get("S3_ACCESS_KEY", "")
SECRET_KEY = os.environ.get("S3_SECRET_KEY", "")
ENDPOINT = os.environ.get("S3_ENDPOINT", "https://s3.ru1.storage.beget.cloud")
BUCKET = os.environ.get("S3_BUCKET", "67dfb2b63527-present-alya")

FILE_PATH = "website/public/downloads/RheoLab-Enterprise-Setup.exe"
S3_KEY = "downloads/RheoLab-Enterprise-Setup.exe"

def main():
    if not ACCESS_KEY or not SECRET_KEY:
        print("Error: S3_ACCESS_KEY and S3_SECRET_KEY environment variables must be set.")
        print("Example: S3_ACCESS_KEY=... S3_SECRET_KEY=... python upload_installer_to_s3.py")
        sys.exit(1)

    if not os.path.exists(FILE_PATH):
        print(f"Error: File not found: {FILE_PATH}")
        return

    file_size = os.path.getsize(FILE_PATH)
    print(f"File size: {file_size / 1024 / 1024:.2f} MB")

    # Use v2 signature for compatibility
    session = boto3.session.Session()
    s3 = session.client(
        service_name='s3',
        endpoint_url=ENDPOINT,
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        config=Config(signature_version='s3')
    )

    try:
        print(f"Uploading {FILE_PATH} to s3://{BUCKET}/{S3_KEY}...")
        
        with open(FILE_PATH, "rb") as f:
            s3.put_object(
                Bucket=BUCKET,
                Key=S3_KEY,
                Body=f,
                ACL='public-read',
                ContentType='application/vnd.microsoft.portable-executable'
            )
            
        print("✅ Upload successful!")
        
        # Generate Public URL
        url = f"https://{BUCKET}.s3.ru1.storage.beget.cloud/{S3_KEY}"
        print(f"🔗 Public URL: {url}")
        
    except Exception as e:
        print(f"❌ Upload failed: {e}")

if __name__ == "__main__":
    main()
