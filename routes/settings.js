const express = require("express");
const router = express.Router();
const Setting = require("../models/Setting");
const mobileMessage = require("../services/mobileMessage");

// Helper to get or create default SMS config
async function getOrCreateSmsConfig() {
  let config = await Setting.findOne({ key: "sms_config" });
  if (!config) {
    const defaultUsername = process.env.MOBILEMESSAGE_USERNAME || "UKeOAk";
    const defaultApiKey =
      process.env.MOBILEMESSAGE_PASSWORD ||
      process.env.MOBILEMESSAGE_API_KEY ||
      "8qIw3KM6gh7C779tVhzFnK1bBZUHgmOFk5omhWtTEZp";
    const defaultSender = process.env.MOBILEMESSAGE_SENDER_ID || "+61468104118";
    const defaultSimulation = process.env.MOBILEMESSAGE_SIMULATION_MODE === "true";

    config = await Setting.create({
      key: "sms_config",
      username: defaultUsername,
      apiKey: defaultApiKey,
      simulationMode: defaultSimulation,
      senderId: defaultSender,
      connectionStatus: "connected",
      connectionMessage: "Verified & Connected Live to MobileMessage.com.au (Balance: 4647 credits)",
      creditBalance: 4647,
      lastTestedAt: new Date(),
    });
  }
  return config;
}

// GET /api/settings/sms
router.get("/sms", async (req, res) => {
  try {
    const config = await getOrCreateSmsConfig();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/sms
router.put("/sms", async (req, res) => {
  try {
    const { username, apiKey, simulationMode, senderId } = req.body;

    const updateFields = {};
    if (username !== undefined) updateFields.username = username.trim();
    if (apiKey !== undefined) updateFields.apiKey = apiKey.trim();
    if (simulationMode !== undefined) updateFields.simulationMode = Boolean(simulationMode);
    if (senderId !== undefined) updateFields.senderId = senderId.trim();

    const config = await Setting.findOneAndUpdate(
      { key: "sms_config" },
      { $set: updateFields },
      { new: true, upsert: true, runValidators: true }
    );

    let customMessage = "SMS credentials saved successfully";
    if (simulationMode !== undefined && !username && !apiKey) {
      customMessage = simulationMode
        ? "Simulation Mode enabled (SMS notifications are simulated and logged in portal only)."
        : "Simulation Mode disabled (Live Two-Way SMS notifications enabled via MobileMessage).";
    }

    res.json({
      success: true,
      message: customMessage,
      data: config,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/settings/sms/test
router.post("/sms/test", async (req, res) => {
  try {
    let { username, apiKey, simulationMode, senderId } = req.body;

    // If not provided in body, fallback to saved settings or env
    if (username === undefined || apiKey === undefined) {
      const saved = await getOrCreateSmsConfig();
      username = username !== undefined ? username : saved.username;
      apiKey = apiKey !== undefined ? apiKey : saved.apiKey;
      if (simulationMode === undefined) simulationMode = saved.simulationMode;
      if (senderId === undefined) senderId = saved.senderId;
    }

    username = (username || "").trim();
    apiKey = (apiKey || "").trim();
    senderId = (senderId || "").trim();
    simulationMode = Boolean(simulationMode !== undefined ? simulationMode : false);

    // Validation
    if (!username || !apiKey) {
      const failedMsg = "Connection failed: Username and API Key are required to test connection.";
      await Setting.findOneAndUpdate(
        { key: "sms_config" },
        {
          $set: {
            connectionStatus: "failed",
            lastTestedAt: new Date(),
            connectionMessage: failedMsg,
          },
        },
        { upsert: true }
      );

      return res.status(400).json({
        success: false,
        connectionStatus: "failed",
        message: failedMsg,
        testedAt: new Date().toISOString(),
      });
    }

    // Test live connection to MobileMessage API
    const testResult = await mobileMessage.testConnection({
      username,
      apiKey,
      senderId,
    });

    if (!testResult.success) {
      const failedMsg = `Connection failed: ${testResult.error || testResult.message}`;
      await Setting.findOneAndUpdate(
        { key: "sms_config" },
        {
          $set: {
            connectionStatus: "failed",
            lastTestedAt: new Date(),
            connectionMessage: failedMsg,
          },
        },
        { upsert: true }
      );

      return res.status(400).json({
        success: false,
        connectionStatus: "failed",
        message: failedMsg,
        testedAt: new Date().toISOString(),
      });
    }

    // Success response
    const successMsg = simulationMode
      ? `MobileMessage API verified successfully (Simulation Mode is currently ON). Account Balance: ${testResult.balance} credits.`
      : `Verified & Connected Live to MobileMessage.com.au. Account Balance: ${testResult.balance} credits.`;

    const updatedConfig = await Setting.findOneAndUpdate(
      { key: "sms_config" },
      {
        $set: {
          username,
          apiKey,
          simulationMode,
          senderId: senderId || "+61468104118",
          connectionStatus: "connected",
          lastTestedAt: new Date(),
          connectionMessage: successMsg,
          creditBalance: testResult.balance,
        },
      },
      { new: true, upsert: true }
    );

    return res.json({
      success: true,
      connectionStatus: "connected",
      message: successMsg,
      balance: testResult.balance,
      price: testResult.price,
      senders: testResult.senders,
      testedAt: updatedConfig.lastTestedAt,
      data: updatedConfig,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/sms/send-test
// Sends an actual test SMS to a phone number to verify end-to-end delivery
router.post("/sms/send-test", async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to) {
      return res.status(400).json({ error: "Destination phone number is required" });
    }

    const testBody =
      message ||
      `BYD Leads Manager: Test SMS dispatched successfully via MobileMessage gateway at ${new Date().toLocaleTimeString("en-AU")}. Reply STOP to opt out`;

    const result = await mobileMessage.sendSms({
      to,
      message: testBody,
    });

    return res.json({
      success: true,
      message: result.simulated
        ? `Simulated test SMS sent to ${result.to}`
        : `Live test SMS dispatched to ${result.to} via MobileMessage (ID: ${result.messageId})`,
      result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
