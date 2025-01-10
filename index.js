require('dotenv').config();
const { Client, Intents } = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');

// Discord Bot Setup
const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.DIRECT_MESSAGES], partials: ['CHANNEL'] });

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Failed to connect to MongoDB', err));

// User Schema
const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  crypt: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  lastDaily: { type: Date, default: null },
  userID: String, // Store Discord userID
});
const User = mongoose.model('User', userSchema);

// Express App Setup
const app = express();
const PORT = process.env.PORT || 3000;

// Express Middleware
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Discord Slash Commands Setup
const commands = [
  {
    name: 'create',
    description: 'Create a new account',
  },
  {
    name: 'profile',
    description: 'View your account profile',
  },
  {
    name: 'crypt',
    description: 'Check or transfer crypt',
    options: [
      {
        name: 'user',
        description: 'User to transfer crypt to',
        type: 6, // USER type
        required: false
      },
      {
        name: 'amount',
        description: 'Amount of crypt to transfer',
        type: 4, // INTEGER type
        required: false
      }
    ]
  }
];

const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
  console.log(`Logged in as ${client.user.tag}!`);
});

// Slash Command Handlers
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'create') {
    const user = await User.findOne({ userID: interaction.user.id });
    if (user) {
      await interaction.reply('You already have an account!');
      return;
    }

    const dmChannel = await interaction.user.createDM().catch(() => null);

    if (dmChannel) {
      await dmChannel.send('Hi, you are now creating an account! Please enter a username (must not be used by another user).');

      if (!interaction.replied) {
        await interaction.reply('Check your DM to continue creating your account.');
      }

      const filter = (m) => m.author.id === interaction.user.id;
      const collector = dmChannel.createMessageCollector({ filter, time: 60000 });

      let step = 0;
      let tempUser = { username: '', password: '', userID: interaction.user.id };

      collector.on('collect', async (msg) => {
        if (step === 0) {
          const username = msg.content.trim();
          if (username.length < 2 || username.length > 10 || await User.findOne({ username })) {
            await msg.reply('Invalid username or already taken. Please try again.');
          } else {
            tempUser.username = username;
            await msg.reply('Great! Now enter the password for this account (at least 8 characters with 2 numbers).');
            step++;
          }
        } else if (step === 1) {
          const password = msg.content.trim();
          if (password.length < 8 || !/\d.*\d/.test(password)) {
            await msg.reply('Password must be at least 8 characters and contain at least 2 numbers. Try again.');
          } else {
            tempUser.password = password;
            await User.create(tempUser);
            await msg.reply(`Congrats! Your account was created successfully!\nUsername: ${tempUser.username}\nPassword: ||${tempUser.password}||`);
            collector.stop();
          }
        }
      });

      collector.on('end', (collected) => {
        if (collected.size < 2) {
          dmChannel.send('Account creation timed out. Please try again.');
        }
      });
    } else {
      await interaction.reply('I cannot DM you. Please make sure your DMs are enabled.');
    }
  }

  if (commandName === 'profile') {
    const user = await User.findOne({ userID: interaction.user.id });
    if (!user) {
      await interaction.reply("You don't have an account yet. Use /create to create one.");
      return;
    }

    const memberSince = new Date(user.createdAt);
    const now = new Date();
    const diffTime = Math.abs(now - memberSince);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const embed = {
      color: 0x3498db,
      title: 'User Information',
      description: 'Here is your account information:',
      fields: [
        { name: 'Username', value: user.username, inline: true },
        { name: 'Crypt', value: `${user.crypt}`, inline: true },
        { name: 'Member since in bot', value: `${diffDays} days`, inline: true },
      ],
      timestamp: new Date(),
    };

    await interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'crypt') {
    const targetUser = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');

    if (interaction.user.bot) {
      await interaction.reply('Bots cannot use commands.');
      return;
    }

    const sender = await User.findOne({ userID: interaction.user.id });
    if (!sender) {
      await interaction.reply("You don't have an account yet. Use /create to create one.");
      return;
    }

    if (targetUser && (targetUser.bot || targetUser.id === interaction.user.id)) {
      await interaction.reply('You cannot transfer crypt to bots or yourself.');
      return;
    }

    if (!targetUser && !amount) {
      await interaction.reply(`Your current crypt balance is ${sender.crypt}.`);
      return;
    }

    if (targetUser && !amount) {
      const targetAccount = await User.findOne({ userID: targetUser.id });
      if (!targetAccount) {
        await interaction.reply(`${targetUser.username} does not have an account.`);
      } else {
        await interaction.reply(`${targetUser.username} has ${targetAccount.crypt} crypt.`);
      }
      return;
    }

    if (targetUser && amount) {
      if (amount <= 0) {
        await interaction.reply('Invalid crypt amount.');
        return;
      }

      if (sender.crypt < amount) {
        await interaction.reply('You do not have enough crypt to complete this transaction.');
        return;
      }

      const recipient = await User.findOne({ userID: targetUser.id });
      if (!recipient) {
        await interaction.reply(`${targetUser.username} does not have an account.`);
        return;
      }

      sender.crypt -= amount;
      recipient.crypt += amount;
      await sender.save();
      await recipient.save();

      await interaction.reply(`Successfully transferred ${amount} crypt to ${targetUser.username}.`);

      const dmChannel = await targetUser.createDM().catch(() => null);
      if (dmChannel) {
        dmChannel.send(
          `Transfer notification, Transfer Receipt:\n\`\`\`\nYou have received ${amount} crypt from user ${interaction.user.username} in bot user ${interaction.user.tag} id ${interaction.user.id}\n\`\`\``
        );
      }
    }
  }
});

// Express Routes
app.get('/', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username, password });

  if (!user) {
    return res.render('login', { error: 'Invalid username or password' });
  }

  req.session.user = user;
  res.redirect('/daily');
});

app.get('/daily', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/');
  }

  const captcha = [...Array(6)].map(() => Math.random().toString(36)[2].toUpperCase()).join('');
  req.session.captcha = captcha;
  res.render('daily', {
    username: req.session.user.username,
    captcha,
    error: null,
    success: null,
  });
});

app.post('/daily', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/');
  }

  const { captchaInput } = req.body;
  const user = await User.findById(req.session.user._id);
  const now = new Date();

  if (user.lastDaily && (now - user.lastDaily) < 24 * 60 * 60 * 1000) {
    return res.render('daily', {
      username: user.username,
      captcha: req.session.captcha,
      error: 'You can only claim your daily reward once every 24 hours.',
      success: null,
    });
  }

  if (captchaInput !== req.session.captcha) {
    return res.render('daily', {
      username: req.session.user.username,
      captcha: req.session.captcha,
      error: 'Invalid captcha. Please try again.',
      success: null,
    });
  }

  const randomReward = Math.floor(Math.random() * 101) + 20; // Random reward between 20 and 120
  user.crypt += randomReward; // Add daily reward
  user.lastDaily = now; // Update last daily claim
  await user.save();

  req.session.user = user;
  res.render('daily', {
    username: user.username,
    captcha: req.session.captcha,
    error: null,
    success: `You have received your daily crypt reward of ${randomReward} crypt!`,
  });
});

// Logout Route
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Start Discord Bot and Express Server
client.login(process.env.DISCORD_TOKEN);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
