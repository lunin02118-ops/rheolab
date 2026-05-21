# Offline Corporate Activation

RheoLab supports an offline Corporate activation path for corporate machines
without internet access.

## Flow

1. Customer opens `Активация лицензии -> Офлайн корпоративная`.
2. RheoLab generates a request code:
   `RL-REQ1:<base64url-json>`.
3. Customer sends the request code by email.
4. Support pastes the request into the license-server admin. The server creates
   a Corporate license, binds it to the customer machine, signs the response
   with the license-server private key, and returns:
   `RL-ACT1:<base64url-json>`.
5. Customer pastes the activation code into RheoLab.
6. The app verifies the RSA signature and the machine binding locally.

No internet connection is required on the customer machine during activation.

## Security Model

- The request code is stable for the current Machine ID and is not secret. It
  contains the machine ID hash and minimal metadata, but it does not contain the
  license key.
- The activation code is trusted only after RSA-SHA256 verification against the
  public key embedded in the app.
- The private signing key must never be stored in the application repository or
  shipped to customers.
- Offline activation is accepted only for `corporate` licenses.
- The signed payload must contain `activationMode: "offline"` or
  `offlineAllowed: true`.
- The signed payload must contain `hardwareBound: true`.
- The signed payload must contain `expiresAt: null`; Corporate offline licenses
  are permanent.
- The signed `machineId` must match the current hardware fingerprint.

## Support Signing

Use the support-side helper:

```powershell
node scripts\licensing\sign-offline-activation.mjs `
  --request-file request.txt `
  --license-key RHEO-XXXX-XXXX-XXXX `
  --customer "Customer Company" `
  --private-key C:\secure\license_private.pem
```

Corporate offline licenses are perpetual: omit `--expires-at` or pass
`--expires-at null`.

The helper can also read the private key from `RHEOLAB_LICENSE_PRIVATE_KEY_PEM`.

## Payload Contract

Activation envelope:

```json
{
  "payload": "{\"id\":\"offline-...\",\"type\":\"corporate\",...}",
  "signature": "base64-rsa-signature"
}
```

Signed payload fields:

```json
{
  "id": "offline-uuid",
  "type": "corporate",
  "customerName": "Customer Company",
  "email": "optional@example.com",
  "issuedAt": "2026-05-05T00:00:00.000Z",
  "expiresAt": null,
  "gracePeriodDays": 30,
  "machineId": "hardware-fingerprint",
  "hardwareBound": true,
  "permanent": true,
  "seats": 1,
  "key": "RHEO-...",
  "activationMode": "offline",
  "offlineAllowed": true,
  "fingerprintVersion": 2
}
```

## Operational Policy

Offline seats are managed manually. Moving a seat to another machine requires a
new request code and a newly signed activation code.
