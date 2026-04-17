<?php
require_once '/var/www/license-server/includes/sign_rsa.php';

$sp = file_get_contents('/tmp/test_sp.txt');
echo "sp_len=" . strlen($sp) . PHP_EOL;
echo "sp=" . $sp . PHP_EOL;

$privkey = openssl_pkey_get_private(file_get_contents('/var/www/license-server/keys/license_private.pem'));
$det = openssl_pkey_get_details($privkey);
$pubkey = openssl_pkey_get_public($det['key']);

// Sign
$sig = '';
openssl_sign($sp, $sig, $privkey, OPENSSL_ALGO_SHA256);
$sig64 = base64_encode($sig);
echo "sig64_len=" . strlen($sig64) . PHP_EOL;
echo "sig64=" . $sig64 . PHP_EOL;

// Verify with same key
$r = openssl_verify($sp, $sig, $pubkey, OPENSSL_ALGO_SHA256);
echo "verify_result=" . $r . PHP_EOL;

// Now also verify the stored signature from DB
// (pasted here for testing)
$stored_sig_b64 = file_get_contents('/tmp/test_sig.txt');
$stored_sig = base64_decode(trim($stored_sig_b64));
$r2 = openssl_verify($sp, $stored_sig, $pubkey, OPENSSL_ALGO_SHA256);
echo "verify_stored_sig=" . $r2 . PHP_EOL;
