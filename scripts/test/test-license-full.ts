
const BASE_URL = 'https://license.vizbuka.ru/api';

async function test() {
    const machineId = 'TEST-MACHINE-' + Math.random().toString(36).substring(7);
    const testKey = 'TEST-1234-5678-ABCD'; // From database.sql
    console.log(`Testing with MachineID: ${machineId}`);

    // 1. Test Demo Registration
    console.log('\n1. Testing Demo Registration...');
    const res1 = await fetch(`${BASE_URL}/register_demo.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId })
    });
    const data1 = await res1.json();
    console.log('Demo Response:', data1);
    if (!data1.success) throw new Error('Demo registration failed');

    // 2. Test Discovery (Should fail initially)
    console.log('\n2. Testing Discovery (expecting failure)...');
    const res2 = await fetch(`${BASE_URL}/find_by_machine.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId })
    });
    const text2 = await res2.text();
    console.log('Discovery Raw Response:', text2);
    let data2;
    try {
        data2 = JSON.parse(text2);
    } catch (e) {
        console.error('Failed to parse JSON:', text2);
        throw e;
    }
    console.log('Discovery Response (Empty):', data2);
    if (data2.success) throw new Error('Discovery should have failed for new machine');

    // 3. Test Activation
    console.log('\n3. Testing Activation...');
    const res3 = await fetch(`${BASE_URL}/activate.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            key: testKey,
            machineId,
            appVersion: '1.0.0',
            platform: 'test'
        })
    });
    const data3 = await res3.json();
    console.log('Activation Response:', data3);
    if (!data3.success) throw new Error('Activation failed: ' + (data3.error || 'Unknown error'));

    // 4. Test Discovery (Should succeed now)
    console.log('\n4. Testing Discovery (expecting success)...');
    const res4 = await fetch(`${BASE_URL}/find_by_machine.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId })
    });
    const data4 = await res4.json();
    console.log('Discovery Response (Success):', data4);
    if (!data4.success) throw new Error('Discovery failed after activation');
    if (data4.license?.key !== testKey) throw new Error(`Discovery returned wrong key: ${data4.license?.key}`);

    // 5. Test Validation
    console.log('\n5. Testing Validation...');
    const res5 = await fetch(`${BASE_URL}/validate.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: testKey, machineId })
    });
    const data5 = await res5.json();
    console.log('Validation Response:', data5);
    if (!data5.success || !data5.valid) throw new Error('Validation failed');

    console.log('\n✅ ALL SERVER TESTS PASSED!');
}

test().catch(e => {
    console.error('\n❌ TEST FAILED:', e.message);
    process.exit(1);
});
