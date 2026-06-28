const bcrypt = require('bcryptjs'); // <-- Added "js" here

// Change 'test1234' to whatever password you want
bcrypt.hash('test1234', 10).then(hash => console.log("YOUR PERFECT HASH IS:", hash));