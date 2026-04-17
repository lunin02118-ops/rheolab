
const SERVER_URL = 'https://license.vizbuka.ru/api/register_demo.php';

async function test() {
    const machineId = 'TEST-MACHINE-' + Math.random().toString(36).substring(7);
    console.log(`Testing with MachineID: ${machineId}`);

    // 1. First Call (New)
    console.log('1. Registering new machine...');
    const res1 = await fetch(SERVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId })
    });

    if (!res1.ok) {
        console.error('Server error:', res1.status, await res1.text());
        return;
    }

    const data1 = await res1.json();
    console.log('Response 1:', data1);

    if (!data1.success || data1.status !== 'new') {
        throw new Error('Failed to register new machine');
    }

    const firstDate = data1.firstSeenAt;

    // 2. Second Call (Existing)
    console.log('2. Checking existing machine...');
    const res2 = await fetch(SERVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId })
    });

    const data2 = await res2.json();
    console.log('Response 2:', data2);

    if (!data2.success || data2.status !== 'existing') {
        throw new Error('Failed to check existing machine');
    }

    if (data2.firstSeenAt !== firstDate) {
        throw new Error(`Date mismatch! Expected ${firstDate}, got ${data2.firstSeenAt}`);
    }

    console.log('✅ Server test PASSED!');
}

test().catch(console.error);
