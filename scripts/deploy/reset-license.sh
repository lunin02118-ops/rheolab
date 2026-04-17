#!/bin/bash
# Reset license machine_id
mysql rheolab_license -e "UPDATE license_keys SET machine_id = NULL, activated_at = NULL, current_activations = 0 WHERE license_key = 'PCIO-AETK-OPCX-J6BY';"
echo "Machine ID reset for PCIO-AETK-OPCX-J6BY"
mysql rheolab_license -e "SELECT license_key, machine_id, activated_at, current_activations FROM license_keys WHERE license_key = 'PCIO-AETK-OPCX-J6BY';"
