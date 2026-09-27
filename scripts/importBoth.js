const runSeed = require("../seed/seed-both");

if (require.main === module) {
  const filePathArg = process.argv[2];
  runSeed(filePathArg)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = runSeed;
