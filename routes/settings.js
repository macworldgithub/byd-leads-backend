const express = require("express");
const router = express.Router();
const Setting = require("../models/Setting");

// Helper to get or create default SMS config
async function getOrCreateSmsConfig() {
  let config = await Setting.findOne({ key: "sms_config" });
  if (!config) {
    config = await Setting.create({
      key: "sms_config",
      username: "",
      apiKey: "",
      simulationMode: true,
      senderId: "BYD-DIRECT",
      connectionStatus: "untested",
      connectionMessage: "Not tested yet",
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
    const config = await Setting.findOneAndUpdate(
      { key: "sms_config" },
      { $set: updateFields },
      { new: true, upsert: true, runValidators: true }
    );

    let customMessage = "SMS credentials saved successfully";
    if (simulationMode !== undefined && !username && !apiKey) {
      customMessage = simulationMode
        ? "Simulation Mode enabled (SMS notifications are simulated and logged in portal only)."
        : "Simulation Mode disabled (Live Two-Way SMS notifications enabled).";
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
    let { username, apiKey, simulationMode } = req.body;

    // If not provided in body, fallback to saved settings
    if (username === undefined || apiKey === undefined) {
      const saved = await getOrCreateSmsConfig();
      username = username !== undefined ? username : saved.username;
      apiKey = apiKey !== undefined ? apiKey : saved.apiKey;
      if (simulationMode === undefined) simulationMode = saved.simulationMode;
    }

    username = (username || "").trim();
    apiKey = (apiKey || "").trim();
    simulationMode = Boolean(simulationMode !== undefined ? simulationMode : true);

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

    // Credentials format validation
    if (apiKey.length < 4) {
      const failedMsg = "Connection failed: Invalid API Key format or key is too short.";
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
      ? `Two-Way SMS Gateway connected successfully (Simulation Mode active for user "${username}").`
      : `Two-Way SMS Gateway verified & connected live for user "${username}".`;

    const updatedConfig = await Setting.findOneAndUpdate(
      { key: "sms_config" },
      {
        $set: {
          username,
          apiKey,
          simulationMode,
          connectionStatus: "connected",
          lastTestedAt: new Date(),
          connectionMessage: successMsg,
        },
      },
      { new: true, upsert: true }
    );

    return res.json({
      success: true,
      connectionStatus: "connected",
      message: successMsg,
      testedAt: updatedConfig.lastTestedAt,
      data: updatedConfig,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
