# Offline Enterprise Activation

RheoLab supports an offline Enterprise activation path for corporate machines
without internet access.

## Flow

1. Customer opens `Активация лицензии -> Офлайн Enterprise`.
2. RheoLab generates a request code:
   `RHEOLAB-OFFLINE-REQ-v1:<base64url-json>`.
3. Customer sends the request code by email.
4. Support signs the request with the license-server private key and returns:
   `RHEOLAB-OFFLINE-ACT-v1:<base64url-json>`.
5. Customer pastes the activation code into RheoLab.
6. The app verifies the RSA signature and the machine binding locally.

No internet connection is required on the customer machine during activation.

## Security Model

- The request code is not secret. It contains the machine ID hash and metadata.
- The activation code is trusted only after RSA-SHA256 verification against the
  public key embedded in the app.
- The private signing key must never be stored in the application repository or
  shipped to customers.
- Offline activation is accepted only for `enterprise` licenses.
- The signed payload must contain `activationMode: "offline"` or
  `offlineAllowed: true`.
- The signed `machineId` must match the current hardware fingerprint or a known
  legacy machine ID.

## Support Signing

Use the support-side helper:

```powershell
node scripts\licensing\sign-offline-activation.mjs `
  --request-file request.txt `
  --license-key RHEO-XXXX-XXXX-XXXX `
  --customer "Customer Company" `
  --private-key C:\secure\license_private.pem
```

For perpetual licenses omit `--expires-at` or pass `--expires-at null`.

The helper can also read the private key from `RHEOLAB_LICENSE_PRIVATE_KEY_PEM`.

## Payload Contract

Activation envelope:

```json
{
  "payload": "{\"id\":\"offline-...\",\"type\":\"enterprise\",...}",
  "signature": "base64-rsa-signature"
}
```

Signed payload fields:

```json
{
  "id": "offline-uuid",
  "type": "enterprise",
  "customerName": "Customer Company",
  "email": "optional@example.com",
  "issuedAt": "2026-05-05T00:00:00.000Z",
  "expiresAt": null,
  "gracePeriodDays": 30,
  "machineId": "hardware-fingerprint",
  "seats": 1,
  "key": "RHEO-...",
  "activationMode": "offline",
  "offlineAllowed": true,
  "offlineRequestId": "request-uuid",
  "fingerprintVersion": 2
}
```

## Operational Policy

Offline seats are managed manually. Moving a seat to another machine requires a
new request code and a newly signed activation code.
