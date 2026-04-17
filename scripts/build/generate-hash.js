const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync('admin', 10);
console.log('Generated hash for "admin":', hash);
