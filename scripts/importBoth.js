const { main } = require("../seed/upsert-both");

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = require("../seed/seed-both");
