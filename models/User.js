const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["super_admin", "admin", "site_admin", "sales_manager", "agent", "consultant", "sales_consultant", "bdc", "delivery", "contractor"],
      default: "agent",
    },
    site: {
      type: String,
      default: "",
    },
    locked_site: {
      type: String,
      default: "",
    },
    password_hash: {
      type: String,
      required: true,
      select: false,
    },
    allowed_sites: { type: [String], default: undefined },
    all_sites: { type: Boolean, default: undefined },
    platform_access: { type: [String], default: undefined },
    auth_version: { type: Number, default: 0 },
    deleted_at: { type: Date, default: null },
    active: {
      type: Boolean,
      default: true,
    },
    last_login_at: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = async function (plainPassword) {
  return bcrypt.compare(plainPassword, this.password_hash);
};

userSchema.statics.hashPassword = async function (plainPassword) {
  return bcrypt.hash(plainPassword, 12);
};

module.exports = mongoose.model("User", userSchema);
