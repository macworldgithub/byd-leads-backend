/**
 * mobileMessage.js – MobileMessage.com.au Two-Way SMS Gateway Client
 * Handles HTTP Basic Auth, Australian E.164 phone normalization,
 * message dispatch, concurrency retry, and live connectivity diagnostics.
 */

const crypto = require("crypto");
const Setting = require("../models/Setting");

const DEFAULT_BASE_URL = "https://api.mobilemessage.com.au";

/**
 * Normalizes phone numbers to standard Australian international format (+614XXXXXXXX)
 * @param {string} phone
 * @returns {string} Normalized phone number
 */
function normalizeAustralianPhone(phone) {
  if (!phone) return "";
  let cleaned = String(phone).replace(/[\s\-\(\)]/g, "");

  // 04XX XXX XXX -> +614XXXXXXXX
  if (/^04\d{8}$/.test(cleaned)) {
    return "+61" + cleaned.substring(1);
  }

  // 4XXXXXXXX -> +614XXXXXXXX
  if (/^4\d{8}$/.test(cleaned)) {
    return "+61" + cleaned;
  }

  // 614XXXXXXXX -> +614XXXXXXXX
  if (/^614\d{8}$/.test(cleaned)) {
    return "+" + cleaned;
  }

  // Already +614XXXXXXXX
  if (/^\+614\d{8}$/.test(cleaned)) {
    return cleaned;
  }

  // International or standard format with +
  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  return cleaned;
}

/**
 * Retrieves the active MobileMessage credentials and configuration.
 * Prioritizes database settings (configured via CRM UI), falls back to environment variables.
 */
async function getConfig() {
  const envUsername = process.env.MOBILEMESSAGE_USERNAME || "";
  const envPassword = process.env.MOBILEMESSAGE_PASSWORD || process.env.MOBILEMESSAGE_API_KEY || "";
  const envSender = process.env.MOBILEMESSAGE_SENDER_ID || "+61468104118";
  const envSimulation = process.env.MOBILEMESSAGE_SIMULATION_MODE === "true";
  const apiUrl = process.env.MOBILEMESSAGE_API_URL || DEFAULT_BASE_URL;

  try {
    const mongoose = require("mongoose");
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const setting = await Setting.findOne({ key: "sms_config" }).lean();
      if (setting && setting.username && setting.apiKey) {
        return {
          username: setting.username.trim(),
          password: setting.apiKey.trim(),
          senderId: setting.senderId || envSender,
          simulationMode: Boolean(setting.simulationMode),
          apiUrl,
        };
      }
    }
  } catch (err) {
    console.error("Failed to query sms_config from DB:", err.message);
  }

  return {
    username: envUsername.trim(),
    password: envPassword.trim(),
    senderId: envSender,
    simulationMode: envSimulation,
    apiUrl,
  };
}

/**
 * Sends an SMS message via MobileMessage REST API
 * @param {Object} options
 * @param {string} options.to - Recipient phone number
 * @param {string} options.message - SMS text content
 * @param {string} [options.sender] - Alphanumeric Sender ID or dedicated number
 * @param {string} [options.customRef] - Reference tracking ID
 * @param {string} [options.idempotencyKey] - UUID to prevent duplicate dispatch
 * @returns {Promise<Object>} Send result
 */
async function sendSms({ to, message, sender, customRef, idempotencyKey }) {
  const normalizedPhone = normalizeAustralianPhone(to);
  if (!normalizedPhone) {
    throw new Error("Valid recipient phone number is required");
  }
  if (!message || !message.trim()) {
    throw new Error("Message content is required");
  }

  const config = await getConfig();
  const effectiveSender = sender || config.senderId || "+61468104118";
  const key =
    idempotencyKey ||
    (crypto.randomUUID
      ? crypto.randomUUID()
      : `byd-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`);

  // If simulation mode is explicitly enabled or credentials are missing
  if (config.simulationMode || !config.username || !config.password) {
    const simulatedId = `sim-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    return {
      success: true,
      simulated: true,
      messageId: simulatedId,
      to: normalizedPhone,
      sender: effectiveSender,
      cost: 1,
      status: "simulated",
      sentAt: new Date(),
    };
  }

  // Production live dispatch to MobileMessage REST API
  const authHeader =
    "Basic " + Buffer.from(`${config.username}:${config.password}`).toString("base64");

  const payload = {
    messages: [
      {
        to: normalizedPhone,
        message: message.trim(),
        sender: effectiveSender,
        custom_ref: customRef || undefined,
      },
    ],
  };

  const executeSend = async () => {
    const res = await fetch(`${config.apiUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        "Idempotency-Key": key,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 429) {
      // Concurrency limit reached (max 5 requests in flight). Backoff & retry once.
      await new Promise((resolve) => setTimeout(resolve, 600));
      const retryRes = await fetch(`${config.apiUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          "Idempotency-Key": key,
        },
        body: JSON.stringify(payload),
      });
      const retryData = await retryRes.json().catch(() => ({}));
      if (!retryRes.ok) {
        throw new Error(retryData.error || retryData.message || `MobileMessage Error: HTTP ${retryRes.status}`);
      }
      return retryData;
    }

    if (!res.ok) {
      throw new Error(data.error || data.message || `MobileMessage Error: HTTP ${res.status}`);
    }

    return data;
  };

  const responseData = await executeSend();

  const firstResult = responseData.results && responseData.results[0];
  if (!firstResult) {
    throw new Error("MobileMessage API returned an empty result batch");
  }

  const resultStatus = String(firstResult.status || "").toLowerCase();
  if (resultStatus === "error" || resultStatus === "blocked" || resultStatus === "failed") {
    throw new Error(
      firstResult.error || firstResult.message || `Message delivery failed with status: ${firstResult.status}`
    );
  }

  return {
    success: true,
    simulated: false,
    messageId: firstResult.message_id,
    sendId: responseData.send_id,
    cost: firstResult.cost,
    status: firstResult.status || "queued",
    to: firstResult.to,
    sender: firstResult.sender || effectiveSender,
    sentAt: new Date(),
    raw: responseData,
  };
}

/**
 * Tests connection to MobileMessage and retrieves account balance + approved senders.
 * @param {Object} [overrideCredentials] - Optional { username, apiKey/password, senderId }
 */
async function testConnection(overrideCredentials) {
  const config = overrideCredentials || (await getConfig());
  const username = (config.username || "").trim();
  const password = (config.password || config.apiKey || "").trim();
  const apiUrl = config.apiUrl || process.env.MOBILEMESSAGE_API_URL || DEFAULT_BASE_URL;

  if (!username || !password) {
    return {
      success: false,
      status: "failed",
      error: "Username and API key / password must be provided",
      message: "Username and API key / password must be provided",
    };
  }

  const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  try {
    const [accountRes, sendersRes] = await Promise.all([
      fetch(`${apiUrl}/v1/account`, {
        headers: { Authorization: authHeader },
      }),
      fetch(`${apiUrl}/v1/senders`, {
        headers: { Authorization: authHeader },
      }),
    ]);

    const accountData = await accountRes.json().catch(() => ({}));
    const sendersData = await sendersRes.json().catch(() => ({}));

    if (!accountRes.ok) {
      const errMsg = accountData.error || accountData.message || `Account check failed with HTTP ${accountRes.status}`;
      return {
        success: false,
        status: "failed",
        error: errMsg,
        message: errMsg,
      };
    }

    const balance = accountData.credit_balance !== undefined ? accountData.credit_balance : 0;
    const sendersList = sendersData.results || [];

    return {
      success: true,
      status: "connected",
      balance,
      price: accountData.credit_price,
      senders: sendersList,
      message: `Verified & Connected Live to MobileMessage.com.au (Balance: ${balance} credits)`,
    };
  } catch (err) {
    return {
      success: false,
      status: "failed",
      error: err.message || "Connection failed",
      message: err.message || "Connection to MobileMessage failed",
    };
  }
}

/**
 * Looks up message delivery status by MobileMessage message_id UUID
 * @param {string} messageId
 */
async function lookupMessage(messageId) {
  const config = await getConfig();
  if (config.simulationMode || !config.username || !config.password) {
    return {
      message_id: messageId,
      status: "delivered",
      simulated: true,
    };
  }

  const authHeader =
    "Basic " + Buffer.from(`${config.username}:${config.password}`).toString("base64");
  const res = await fetch(
    `${config.apiUrl}/v1/messages?message_id=${encodeURIComponent(messageId)}`,
    {
      headers: { Authorization: authHeader },
    }
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Lookup failed with HTTP ${res.status}`);
  }

  return data;
}

module.exports = {
  normalizeAustralianPhone,
  getConfig,
  sendSms,
  testConnection,
  lookupMessage,
};
