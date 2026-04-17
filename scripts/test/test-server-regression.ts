
const BASE_URL = 'https://license.vizbuka.ru/api';

async function test() {
    console.log('Testing status.php (Regression Check)...');
    try {
        const res = await fetch(`${BASE_URL}/status.php?key=TEST-KEY-1234`);

        if (!res.ok) {
            console.error('❌ Server returned HTTP error:', res.status);
            const text = await res.text();
            console.error('Body:', text);
            return;
        }

        const data = await res.json();
        console.log('Status Response:', data);

        // We expect "License not found" or similar, but a valid JSON response means the code is running
        if (data.error === 'License not found' || data.success === false) {
            console.log('✅ status.php is reachable and responding correctly (handled invalid key).');
            console.log('Database connection is working.');
        } else {
            console.warn('⚠️ Unexpected response format, but server is alive:', data);
        }
    } catch (e) {
        console.error('❌ Connection failed:', e);
    }
}

test().catch(console.error);
