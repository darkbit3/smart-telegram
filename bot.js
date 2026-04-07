const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

// Initialize Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// Backend API Configuration
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';

// Notification Settings
const notifications = {
  deposit: process.env.ENABLE_DEPOSIT_NOTIFICATIONS === 'true',
  withdraw: process.env.ENABLE_WITHDRAW_NOTIFICATIONS === 'true',
  error: process.env.ENABLE_ERROR_NOTIFICATIONS === 'true',
  newUser: process.env.ENABLE_NEW_USER_NOTIFICATIONS === 'true'
};

// Message Templates
const messages = {
  deposit: process.env.DEPOSIT_MESSAGE || '💰 New Deposit\nAmount: ${amount}\nUser: ${user}\nTime: ${time}',
  withdraw: process.env.WITHDRAW_MESSAGE || '💸 New Withdrawal\nAmount: ${amount}\nUser: ${user}\nTime: ${time}',
  error: process.env.ERROR_MESSAGE || '🚨 System Error\nError: ${error}\nTime: ${time}',
  newUser: process.env.NEW_USER_MESSAGE || '👋 New User\nUsername: ${username}\nPhone: ${phone}\nTime: ${time}'
};

// Chat ID for notifications
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Helper functions for password reset functionality
async function storeOrUpdateTelegramUser(telegramUserId, userInfo) {
  try {
    // This would connect to your database to store/update telegram user info
    // For now, we'll just log it
    console.log(`📱 Storing telegram user: ${telegramUserId}`, userInfo);
    
    // TODO: Add database connection to store in telegram_users table
    // Example: INSERT OR REPLACE INTO telegram_users (telegram_user_id, phone_number, telegram_username, first_name, last_name) VALUES (?, ?, ?, ?, ?)
    
  } catch (error) {
    console.error('❌ Failed to store telegram user:', error);
  }
}

async function storePhoneNumber(telegramUserId, phoneNumber) {
  try {
    // Always add + prefix for phone numbers (no country code)
    const formattedPhoneNumber = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
    
    console.log(`📱 Storing phone number: ${formattedPhoneNumber} for telegram user: ${telegramUserId}`);
    
    // TODO: Add database connection to store in telegram_users table
    // Example: UPDATE telegram_users SET phone_number = ? WHERE telegram_user_id = ?
    
  } catch (error) {
    console.error('❌ Failed to store phone number:', error);
  }
}

async function notifyBackendPhoneShared(telegramUserId, phoneNumber, userInfo) {
  try {
    console.log(`🔔 Notifying backend about phone sharing: ${phoneNumber} for user: ${telegramUserId}`);
    console.log('🔗 Backend URL:', BACKEND_API_URL);
    console.log('🔑 Admin API Key:', process.env.ADMIN_API_KEY ? 'Set' : 'Not set');
    
    // Call the backend API to save telegram user information
    const response = await fetch(`${BACKEND_API_URL}/api/telegram-phonenumber`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ADMIN_API_KEY}`
      },
      body: JSON.stringify({
        telegramUserId: telegramUserId,
        phoneNumber: phoneNumber,
        username: userInfo.username,
        firstName: userInfo.first_name,
        lastName: userInfo.last_name
      })
    });

    console.log('📡 Response status:', response.status);
    console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));

    if (response.ok) {
      const result = await response.json();
      console.log('✅ Backend notified successfully:', result);
      
      // Check for all pending codes and send them
      await checkAndSendAllPendingCodes(phoneNumber, telegramUserId);
      
      return result;
    } else {
      const errorText = await response.text();
      console.error('❌ Failed to notify backend:');
      console.error('   Status:', response.status);
      console.error('   Status Text:', response.statusText);
      console.error('   Response:', errorText);
      return null;
    }
    
  } catch (error) {
    console.error('❌ Failed to notify backend (Network Error):', error);
    console.error('   Error message:', error.message);
    console.error('   Error stack:', error.stack);
    return null;
  }
}

// Helper function to send verification code
async function sendVerificationCode(chatId, phoneNumber, code) {
  const message = `
🔐 <b>Verification Code</b>

Your password reset verification code is:

<code><b>${code}</b></code>

⏰ This code will expire in 10 minutes.

📝 Enter this code on the website to complete your password reset.

❌ If you didn't request this code, please ignore this message.
  `;
  
  await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
}

// Helper function to format message
function formatMessage(template, data) {
  let message = template;
  Object.keys(data).forEach(key => {
    message = message.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), data[key]);
  });
  return message;
}

// API communication functions
const api = {
  // Get recent transactions
  async getTransactions(type = 'all', limit = 10) {
    try {
      const response = await axios.get(`${BACKEND_API_URL}/api/admin-transactions`, {
        params: { type, limit },
        headers: {
          'Authorization': `Bearer ${process.env.ADMIN_API_KEY}`
        }
      });
      return response.data;
    } catch (error) {
      console.error('❌ Failed to fetch transactions:', error.message);
      return null;
    }
  },

  // Get system stats
  async getStats() {
    try {
      const response = await axios.get(`${BACKEND_API_URL}/api/admin-transactions/summary`, {
        headers: {
          'Authorization': `Bearer ${process.env.ADMIN_API_KEY}`
        }
      });
      return response.data;
    } catch (error) {
      console.error('❌ Failed to fetch stats:', error.message);
      return null;
    }
  },

  // Get user info
  async getUserInfo(userId) {
    try {
      const response = await axios.get(`${BACKEND_API_URL}/api/admin/player-by-id`, {
        params: { id: userId },
        headers: {
          'Authorization': `Bearer ${process.env.ADMIN_API_KEY}`
        }
      });
      return response.data;
    } catch (error) {
      console.error('❌ Failed to fetch user info:', error.message);
      return null;
    }
  }
};

// Bot command handlers - Password Reset Focused
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramUserId = msg.from.id;
  
  // Store or update telegram user info
  await storeOrUpdateTelegramUser(telegramUserId, msg.from);
  
  // Check for any pending codes for this user
  const userInfo = msg.from;
  if (userInfo.phone_number) {
    // If user already has phone number, check for pending codes
    await checkAndSendAllPendingCodes(userInfo.phone_number, telegramUserId);
  }
  
  const welcomeMessage = `
🔐 <b>Password Reset Service</b>

Welcome to the Smart Betting password reset system!

To reset your password, please share your phone number with this bot so we can verify your identity.

<b>Steps:</b>
1. Click the "Share Phone Number" button below
2. We'll verify your phone number
3. Return to the website to continue the reset process

📱 <b>Required:</b> Share your phone number to continue
  `;
  
  const keyboard = {
    keyboard: [[
      {
        text: "📱 Share Phone Number",
        request_contact: true
      }
    ]],
    resize_keyboard: true,
    one_time_keyboard: true
  };
  
  await bot.sendMessage(chatId, welcomeMessage, { 
    parse_mode: 'HTML',
    reply_markup: keyboard
  });
});

// Handle phone number sharing
bot.on('contact', async (msg) => {
  const chatId = msg.chat.id;
  const telegramUserId = msg.from.id;
  const contact = msg.contact;
  
  if (contact.user_id !== telegramUserId) {
    await bot.sendMessage(chatId, "❌ Please share your own phone number, not someone else's.");
    return;
  }
  
  const phoneNumber = contact.phone_number;
  const userInfo = msg.from;
  
  // Store or update telegram user in database
  await storeOrUpdateTelegramUser(telegramUserId, {
    id: telegramUserId,
    is_bot: userInfo.is_bot || false,
    first_name: userInfo.first_name || 'Unknown',
    username: userInfo.username || 'unknown'
  });
  
  // Store phone number in database
  await storePhoneNumber(telegramUserId, phoneNumber);
  
  // Notify backend about the phone number sharing
  await notifyBackendPhoneShared(telegramUserId, phoneNumber, userInfo);
  
  // Check for all pending codes and send them
  await checkAndSendAllPendingCodes(phoneNumber, telegramUserId);
  
  const thankYouMessage = `
✅ <b>Thank You!</b>

Your phone number has been shared successfully: <code>${phoneNumber}</code>

🔄 <b>Next Steps:</b>
1. Return to the website
2. Try to password reset again
3. You should now be able to receive a verification code

🔔 Once you receive the code on the website, come back here to get your verification code!

<b>Important:</b> This phone number is now linked to your account for password reset.
  `;
  
  // Remove the keyboard after phone number is shared
  await bot.sendMessage(chatId, thankYouMessage, { 
    parse_mode: 'HTML',
    reply_markup: { remove_keyboard: true }
  });
});

// Handle other commands - redirect to password reset
bot.onText(/\/help/, (msg) => {
  const helpMessage = `
🔐 <b>Password Reset Bot</b>

This bot is specifically designed for password reset functionality.

<b>How to use:</b>
1. Click the "Share Phone Number" button when prompted
2. Wait for verification
3. Return to website to complete password reset

<b>Commands:</b>
/start - Start password reset process
/help - Show this help message

❌ Other commands are not available as this bot is dedicated to password reset only.
  `;
  
  bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'HTML' });
});

// Handle any other text messages
bot.on('message', async (msg) => {
  // Skip if it's a contact or command
  if (msg.contact || msg.text?.startsWith('/')) return;
  
  const chatId = msg.chat.id;
  
  await bot.sendMessage(chatId, `
🔐 <b>Password Reset Bot</b>

This bot only supports password reset functionality.

Please use the "Share Phone Number" button to continue with password reset.

Type /start to begin the password reset process.
  `, { parse_mode: 'HTML' });
});

// Notification functions for backend integration
const notificationsAPI = {
  // Send deposit notification
  async sendDepositNotification(amount, user, time) {
    if (!notifications.deposit) return;
    
    const message = formatMessage(messages.deposit, { amount, user, time });
    await sendMessage(message);
  },

  // Send withdrawal notification
  async sendWithdrawNotification(amount, user, time) {
    if (!notifications.withdraw) return;
    
    const message = formatMessage(messages.withdraw, { amount, user, time });
    await sendMessage(message);
  },

  // Send error notification
  async sendErrorNotification(error, time) {
    if (!notifications.error) return;
    
    // FIXED: Removed the extra closing brace and properly structured the object
    const message = formatMessage(messages.error, { error, time });
    await sendMessage(message);
  },

  // Send new user notification
  async sendNewUserNotification(username, phone, time) {
    if (!notifications.newUser) return;
    
    const message = formatMessage(messages.newUser, { username, phone, time });
    await sendMessage(message);
  }
};

// Express server for webhook notifications (optional)
const express = require('express');
const app = express();

app.use(express.json());

// Webhook endpoint for backend notifications
app.post('/notify', async (req, res) => {
  const { type, data } = req.body;
  
  try {
    switch (type) {
      case 'send_verification_code':
        await handleSendVerificationCode(data);
        break;
        
      case 'send_registration_code':
        await handleSendRegistrationCode(data);
        break;
        
      case 'phone_shared':
        await notificationsAPI.sendDepositNotification(
          data.amount,
          data.user,
          data.time || new Date().toISOString()
        );
        break;
        
      case 'withdraw':
        await notificationsAPI.sendWithdrawNotification(
          data.amount,
          data.user,
          data.time || new Date().toISOString()
        );
        break;
        
      case 'error':
        await notificationsAPI.sendErrorNotification(
          data.error,
          data.time || new Date().toISOString()
        );
        break;
        
      case 'newUser':
        await notificationsAPI.sendNewUserNotification(
          data.username,
          data.phone,
          data.time || new Date().toISOString()
        );
        break;
        
      default:
        console.log('❌ Unknown notification type:', type);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Notification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Handle verification code sending
async function handleSendVerificationCode(data) {
  try {
    const { phoneNumber, code, telegramUserId } = data;
    
    console.log(`🔐 Sending verification code ${code} to phone ${phoneNumber}`);
    
    // Send verification code to user
    const message = `
🔐 <b>Password Reset Code</b>

📱 Phone: ${phoneNumber}
🔢 Code: <b>${code}</b>
⏰ Valid for: 10 minutes

🔒 Please use this code to reset your password
    `;
    
    await bot.sendMessage(telegramUserId, message, { parse_mode: 'HTML' });
    console.log(`✅ Verification code sent to Telegram user ${telegramUserId}`);
    
  } catch (error) {
    console.error('❌ Failed to send verification code:', error);
  }
}

// Handle registration code sending
async function handleSendRegistrationCode(data) {
  try {
    const { phoneNumber, code, telegramUserId } = data;
    
    console.log(`🔐 Sending registration code ${code} to phone ${phoneNumber}`);
    
    // Send registration code to user
    const message = `
🎉 <b>Registration Code</b>

📱 Phone: ${phoneNumber}
🔢 Code: <b>${code}</b>
⏰ Valid for: 10 minutes

🔒 Please use this code to complete your Smart Bet registration
    `;
    
    await bot.sendMessage(telegramUserId, message, { parse_mode: 'HTML' });
    console.log(`✅ Registration code sent to Telegram user ${telegramUserId}`);
    
  } catch (error) {
    console.error('❌ Failed to send registration code:', error);
  }
}

// Check for all pending codes (registration + reset) and send them
async function checkAndSendAllPendingCodes(phoneNumber, telegramUserId) {
  try {
    console.log(`🔍 Checking for all pending codes for phone: ${phoneNumber}`);
    
    // Check for pending registration codes
    const registrationResponse = await fetch(`${BACKEND_API_URL}/api/registration/check-pending`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.ADMIN_API_KEY || 'admin123456789'
      },
      body: JSON.stringify({
        phoneNumber: phoneNumber,
        telegramUserId: telegramUserId
      })
    });

    // Check for pending reset codes
    const resetResponse = await fetch(`${BACKEND_API_URL}/api/player-reset-password/check-pending`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.ADMIN_API_KEY || 'admin123456789'
      },
      body: JSON.stringify({
        phoneNumber: phoneNumber,
        telegramUserId: telegramUserId
      })
    });

    // Process registration codes
    if (registrationResponse.ok) {
      const result = await registrationResponse.json();
      console.log(`📋 Pending registration check result:`, result);
      
      if (result.success && result.data?.pendingCodes && result.data.pendingCodes.length > 0) {
        console.log(`📧 Sending ${result.data.pendingCodes.length} registration codes`);
        for (const pendingCode of result.data.pendingCodes) {
          await handleSendRegistrationCode({
            phoneNumber: pendingCode.phone_number,
            code: pendingCode.reset_code,
            telegramUserId: telegramUserId
          });
        }
      }
    }

    // Process reset codes
    if (resetResponse.ok) {
      const result = await resetResponse.json();
      console.log(`📋 Pending reset check result:`, result);
      
      if (result.success && result.data?.pendingCodes && result.data.pendingCodes.length > 0) {
        console.log(`🔐 Sending ${result.data.pendingCodes.length} reset codes`);
        for (const pendingCode of result.data.pendingCodes) {
          await handleSendVerificationCode({
            phoneNumber: pendingCode.phone_number,
            code: pendingCode.reset_code,
            telegramUserId: telegramUserId
          });
        }
      }
    }

    if (!registrationResponse.ok && !resetResponse.ok) {
      console.error(`❌ Failed to check pending codes: Registration(${registrationResponse.status}) Reset(${resetResponse.status})`);
    } else {
      console.log(`✅ Completed pending code check for phone: ${phoneNumber}`);
    }
    
  } catch (error) {
    console.error('❌ Failed to check pending codes:', error);
  }
}

// Check for pending registration codes and send them
async function checkAndSendPendingRegistrationCodes(phoneNumber, telegramUserId) {
  try {
    console.log(`🔍 Checking for pending registration codes for phone: ${phoneNumber}`);
    
    // Call backend to check for pending registration codes
    const response = await fetch(`${BACKEND_API_URL}/api/registration/check-pending`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.ADMIN_API_KEY || 'admin123456789'
      },
      body: JSON.stringify({
        phoneNumber: phoneNumber,
        telegramUserId: telegramUserId
      })
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`📋 Pending registration check result:`, result);
      
      if (result.success && result.data?.pendingCodes && result.data.pendingCodes.length > 0) {
        // Send all pending registration codes
        for (const pendingCode of result.data.pendingCodes) {
          await handleSendRegistrationCode({
            phoneNumber: pendingCode.phone_number,
            code: pendingCode.reset_code,
            telegramUserId: telegramUserId
          });
        }
        
        console.log(`✅ Sent ${result.data.pendingCodes.length} pending registration codes`);
      } else {
        console.log(`ℹ️ No pending registration codes found for phone: ${phoneNumber}`);
      }
    } else {
      console.error(`❌ Failed to check pending registration codes: ${response.status}`);
    }
    
  } catch (error) {
    console.error('❌ Failed to check pending registration codes:', error);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    bot: 'running'
  });
});

// Start webhook server
const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`🚀 Telegram bot webhook server running on port ${PORT}`);
  console.log(`📱 Bot started successfully`);
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('❌ Telegram polling error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

console.log('🤖 Telegram Bot is starting...');
bot.startPolling();