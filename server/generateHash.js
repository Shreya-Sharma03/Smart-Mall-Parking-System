// Generate a bcrypt hash for the supplied password argument.
// Usage: node generateHash.js <password>
const bcrypt = require('bcryptjs');
const password = process.argv[2];
if (!password) {
  console.error('Usage: node generateHash.js <password>');
  process.exit(1);
}
bcrypt.hash(password, 10)
  .then(hash => console.log(hash))
  .catch(err => console.error(err));
