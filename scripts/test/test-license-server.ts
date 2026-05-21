const SERVER_URL = 'https://license.vizbuka.ru/api/register_demo.php';

async function test() {
    console.log('Testing that legacy demo registration is disabled...');

    const response = await fetch(SERVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId: `TEST-MACHINE-${Date.now()}` }),
    });

    const data = await response.json();
    console.log('Response:', response.status, data);

    if (response.status !== 410 || data.error !== 'demo_removed') {
        throw new Error('Legacy demo endpoint must return 410 demo_removed');
    }

    console.log('Legacy demo endpoint is disabled.');
}

test().catch((error) => {
    console.error(error);
    process.exit(1);
});
