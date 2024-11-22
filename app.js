'use strict';

//Set up express
const express = require('express');
const app = express();

//Setup socket.io
const server = require('http').Server(app);
const io = require('socket.io')(server);

const players = [];
const audienceMembers = [];

//Setup static page handling
app.set('view engine', 'ejs');
app.use('/static', express.static('public'));

//Handle client interface on /
app.get('/', (req, res) => {
  res.render('client');
});
//Handle display interface on /display
app.get('/display', (req, res) => {
  res.render('display');
});

// URL of the backend API
const BACKEND_ENDPOINT = process.env.BACKEND || 'http://localhost:8181';

//Start the server
function startServer() {
    const PORT = process.env.PORT || 8080;
    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
        console.log('Press Ctrl+C to quit.');
    });
}

//Chat message
function handleChat(message) {
    console.log('Handling chat: ' + message); 
    io.emit('chat',message);
}

// handle register
function handleRegister(username, password) {
  console.log('Handling register: ' + username + ' ' + password);
}

// handle login
function handleLogin(username, password) {
  console.log('Handling login: ' + username + ' ' + password);
}

// handle prompt
function handlePrompt(prompt) {
  console.log('Handling prompt: ' + prompt);
}

// handle answer
function handleAnswer(answer) {
  console.log('Handling answer: ' + answer);
}

// handle vote
function handleVote(vote) {
  console.log('Handling vote: ' + vote);
}

// handle next
function handleNext() {
  console.log('Handling next');
}

// Azure Functions
// TODO: call the Azure Functions and return the result
function registerPlayer(username, password) {}
function loginPlayer(username, password) {}
function updatePlayer(username, addToGames, addToScore) {}
function createPrompt(text, username) {}
function deletePrompt(username) {}
function suggestPrompt(keyword) {}
function getUtils(players, langCode) {}
function podium() {}

//Handle new connection
io.on('connection', socket => { 
  console.log('New connection');

  //Handle on chat message received
  socket.on('chat', message => {
    handleChat(message);
  });

  //Handle disconnection
  socket.on('disconnect', () => {
    console.log('Dropped connection');
  });
});

//Start server
if (module === require.main) {
  startServer();
}

module.exports = server;
