'use strict';

//Set up express
const express = require('express');
const app = express();

//Setup socket.io
const server = require('http').Server(app);
const io = require('socket.io')(server);

// set up requests
const axios = require("axios");
const e = require("express");

const players = new Map();
const audience = new Map();
const socketsToUsers = new Map();
const usersToSockets = new Map();
const submittedPrompts = new Map();
let state = {state: 0, players: players, audience: audience, activePrompts: [], roundPrompts: [],
    answersReceived: {}, votesReceived: {}, currentPrompt: null, roundScores: null, totalScores: null,
    language: 'en', roundNumber: 0};

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
const BACKEND_ENDPOINT = 'http://localhost:8181' || process.env.BACKEND;
const BACKEND_KEY = process.env.BACKEND_KEY || 'test';

//Start the server
function startServer() {
    const PORT = process.env.PORT || 8080;
    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
        console.log('Press Ctrl+C to quit.');
        console.log('Using backend at: ' + BACKEND_ENDPOINT);
    });
}

//Chat message
function handleChat(message) {
    console.log('Handling chat: ' + message);
    io.emit('chat',message);
}

//Handle announcements
function announce(message) {
    console.log('Announcement: ' + message);
    io.emit('chat',message);
}

// send error
function error(socket, message, halt) {
    console.log('Error: ' + message);
    socket.emit('fail', message);
    if(halt) {
        socket.disconnect();
    }
}

//Update state of all users
function updateAll() {
    console.log('Updating all players');
    for(let [_,socket] of usersToSockets) {
        updateUser(socket);
    }
}

//Update one user
function updateUser(socket) {
    const username = socketsToUsers.get(socket);
    const theUser = players.get(username);
    const data = { state: state, me: theUser, players: Object.fromEntries(players) };
    socket.emit('state', data);
}

//Handle joining of players
function handleJoin(socket, username) {
    console.log('Joining game: ' + username);
    announce("Welcome to the game, " + username + "!");
    
    const player = { username: username, score: 0, state: 1, prompts:[], prompt:''};
    // if player joined after game started are audience
    if (state.state > 1) {
        player.role = 2;
        audience.set(username, player);
    } else {
        // determine if admin, player or audience
        if (players.size === 0) {
            player.role = 0;
            players.set(username, player);
        } else if (players.size < 8) {
            player.role = 1;
            players.set(username, player);
        } else {
            player.role = 2;
            audience.set(username, player);
        }
    }
    socketsToUsers.set(socket, username);
    usersToSockets.set(username, socket);
    updateAll();
}

// handle register
async function handleRegister(socket, username, password) {
    console.log('Handling register: ' + username + ' ' + password);
    try {
        const response = await registerPlayerAz(username, password);
        console.log('Handle function response:' + response);
        if (response.result == true) {
            console.log('Player registered successfully');
            handleJoin(socket, username);
        } else {
            console.log('Player not registered');
            error(socket, response.msg, false);
        }
    } catch (e) {
        console.log('Error in register');
        console.log(e);
        error(socket, 'Error in register', false);
    }
}

// handle login
async function handleLogin(socket, username, password) {
    try {
        // const response = await callAzureFunction('/player/login', 'get', {username,password});
        const response = await loginPlayerAz(username, password);
        console.log('Handle function response:' + response);
        if (response.result === true) {
            console.log('Player logged in successfully');
            handleJoin(socket, username);
        } else {
            console.log('Player not logged in');
            error(socket, response.msg, false);
        }
    } catch (e) {
        console.log('Error in login');
        console.log(e);
        error(socket, 'Error in login', false);
    }
}

// handle prompt
function handlePrompt(socket, prompt) {
    console.log('Handling prompt submission: ' + prompt);
    const username = socketsToUsers.get(socket);
    const isPlayer = players.has(username);
    let user = null;
    if (isPlayer) {
        user = players.get(username);
    } else {
        user = audience.get(username);
    }
    
    // submit prompt to API
    const response = createPromptAz(prompt, username);
    const data = response.data;
    if (data.result === true) {
        console.log('Prompt submitted successfully');
    } else {
        console.log('Prompt not submitted');
        error(socket, data.msg, false);
        return;
    }
    
    // check if waiting for prompt in prompts phase, as we can submit whenever in the game
    if (user.state === 2) {
        user.state = 3;
        submittedPrompts.set(username, prompt);
    } else{
        state.activePrompts.push(prompt);
    }
}

// handle answer
function handleAnswer(socket, answer, prompt) {
    console.log('Handling answer: ' + answer + ' to prompt: ' + prompt);
    const username = socketsToUsers.get(socket);
    const playerState = players.get(username);
    
    // store answer to prompt
    if (state.answersReceived.has(prompt)) {
        state.answersReceived[prompt].push({answer: answer, username: username});
    } else {
        state.answersReceived[prompt] = [{answer: answer, username: username}];
    }
    
    // check if player has more prompts to answer
    if (playerState.prompts.length !== 0) {
        playerState.prompt = playerState.prompts.pop();
    } else {
        playerState.state = 5;
    }
}

// handle vote
function handleVote(socket, answer, prompt) {
    console.log('Handling vote to: ' + answer + ' for prompt: ' + prompt);
    const username = socketsToUsers.get(socket);
    const isPlayer = players.has(username);
    const user = isPlayer ? players.get(username) : audience.get(username);
    user.state = 8;
    
    // add vote to prompt and answer
    if (state.votesReceived.has(prompt)) {
        state.votesReceived[prompt].push(answer);
    } else {
        state.votesReceived[prompt] = [answer];
    }
    
    // check if all votes are in
    let allVotes = true;
    for (const [_, player] of players) {
        if (player.state < 8) {
            allVotes = false;
            break;
        }
    }
    for (const [_, member] of audience) {
        if (member.state < 8) {
            allVotes = false;
            break;
        }
    }
    if (allVotes) {
        state.currentPrompt = state.roundPrompts.pop();
        
    }
    
}

// handle next
function handleNext(socket) {
    console.log('Handling next');
    // game states: 0=not started, 1=joining, 2=prompts, 3=answers, 4=voting, 5=results, 6=scores, 7=game over
    switch(state.state) {
        case 0:
            console.log('Error in game state');
            break;
        case 1:
            console.log('Advance called from joining phase');
            if (startPrompts(socket)) {
                startGame();
                console.log('Joining phase over, starting prompts suggestions');
                state.state++;
                updateAll();
            }
            break;
        case 2:
            if (endPrompts()) {
                console.log('Prompts phase over, starting answers');
                startAnswers();
                state.state++;
                updateAll();
            }
            break;
        case 3:
            console.log('Answers phase over, starting votes');
            state.state++;
            updateAll();
            endAnswers();
            startVotes();
            break;
        case 4:
            console.log('Votes phase over, starting results');
            state.state++;
            updateAll();
            endVotes();
            startResults();
            break;
        case 5:
            console.log('Results phase over, starting scores');
            state.state++;
            updateAll();
            endResults();
            startScores();
            break;
        case 6:
            console.log('Scores phase over, ending game');
            state.state++;
            updateAll();
            endScores();
            endGame();
            break;
    }
}
// start game
function startGame() {
    console.log('Game starting');
    announce('Let the games begin!');
    // initialize all players
    for(const [_,player] of players) {
        player.state = 2;
    }
    for(const [_,member] of audience) {
        member.state = 2;
    }
    state.roundNumber = 1;
}
// start prompts
function startPrompts(socket) {
    // checking if we can start the game
    if (players.size < 3) {
        error(socket, 'Need at least 3 players to start the game', false);
        return false;
    }
    
    return true;
}
// end prompts
function endPrompts(socket) {
    // check if every player has submitted a prompt
    for (const [_, player] in players) {
        if (player.state !== 3) {
            error(socket, 'Not all players have submitted a prompt', false);
            return false;
        }
    }
    
    // initialize the active prompts
    let numPrompts = 3 * (players.size % 2 === 0 ? players.size / 2 : players.size);
    let promptsGame = Array.from(submittedPrompts.values());
    let promptsApi = getAPIPrompts().filter(prompt => !promptsGame.includes(prompt));
    
    // try to get equal number of prompts from API and game submitted
    if (promptsApi.length > numPrompts/2 && promptsGame.length > numPrompts/2) {
        promptsGame = promptsGame.slice(0, numPrompts/2);
        promptsApi = promptsApi.slice(0, numPrompts/2);
        state.activePrompts = promptsGame.concat(promptsApi);
    } else if (promptsApi.length > numPrompts/2) {
        numPrompts -= promptsGame.length;
        promptsApi = promptsApi.slice(0, numPrompts);
        state.activePrompts = promptsGame.concat(promptsApi);
    } else if (promptsGame.length > numPrompts/2) {
        numPrompts -= promptsApi.length;
        promptsGame = promptsGame.slice(0, numPrompts);
        state.activePrompts = promptsGame.concat(promptsApi);
    } else {
        state.activePrompts = promptsGame.concat(promptsApi);
    }
    
    return true;
}
// start answers
function startAnswers() {
    // set user states 4:players, 6:audience
    for (const [_, player] in players) {
        player.state = 4;
    }
    for (const [_, member] in audience) {
        member.state = 6;
    }
    
    // assign prompts to players
    const evenPlayers = players.size % 2 === 0;
    if (evenPlayers) {
        // assign 1 prompt per player, 2 players per prompt
        const availablePrompt = [];
        for (const [_, player] in players) {
            if (availablePrompt.length === 0) {
                const prompt = state.activePrompts.pop();
                availablePrompt.push(prompt);
                
                player.prompts.push(prompt);
            } else {
                const prompt = availablePrompt.pop();
                player.prompts.push(prompt);
            }
        }
        
    } else {
        // Odd amount of players: assign 2 prompt per player, 2 players per prompt
        for (let i = 0; i < players.size; i++) {
            const prompt = state.activePrompts.pop();
            state.roundPrompts.push(prompt);
            
            const username1 = Array.from(players.keys())[i];
            players.get(username1).prompts.push(prompt);
            
            // assign the prompt to the next player
            if (i === players.size - 1) {
                const username2 = Array.from(players.keys())[0];
                players.get(username2).prompts.push(prompt);
            } else {
                const username2 = Array.from(players.keys())[i+1];
                players.get(username2).prompts.push(prompt);
            }
        }
    }
    
    // add prompt to current prompt
    for (const [_, player] in players) {
        player.prompt = player.prompts.pop();
    }
}
// end answers
function endAnswers() {}
// start votes
function startVotes() {}
// end votes
function endVotes() {}
// start results
function startResults() {}
// end results
function endResults() {}
// start scores
function startScores() {}
// end scores
function endScores() {}
// end game
function endGame() {}

// get prompts from API
function getAPIPrompts() {
    const prompts = [];
    const usernames = Array.from(players.keys());
    const response = getUtilsAz(usernames,state.language);
    const data = response.data;
    for (const entry of data) {
        prompts.push(entry.text);
    }
    return prompts;
}

// Azure Functions
// TODO: handle outputs from the Azure Functions
async function callAzureFunction(endpoint, method, data={}) {
    const url = `${BACKEND_ENDPOINT}${endpoint}`;
    let response = await axios.request({
        url: url,
        method: method,
        data: data,
        headers: {
            'x-functions-key': BACKEND_KEY,
            'Content-Type': 'application/json'
        }
    });
    return response.data;
}
function registerPlayerAz(username, password) {
    return callAzureFunction('/player/register', 'post', {username, password});
}
function loginPlayerAz(username, password) {
    return callAzureFunction('/player/login', 'get', {username, password});
}
function updatePlayerAz(username, addToGames, addToScore) {
    return callAzureFunction('/player/update', 'put', {username, addToGames, addToScore});
}
function createPromptAz(text, username) {
    return callAzureFunction('prompt/create', 'post', {text, username});
}
function deletePromptAz(username) {
    return callAzureFunction('prompt/delete', 'post', {username});
}
function suggestPromptAz(keyword) {
    return callAzureFunction('prompt/suggest', 'post', {keyword});
}
function getUtilsAz(players, langCode) {
    return callAzureFunction('utils/prompts', 'get', {players, langCode});
}
function podiumAz() {
    return callAzureFunction('utils/podium', 'get');
}

//Handle new connection
io.on('connection', socket => {
    console.log('New connection');
    
    //Handle on chat message received
    socket.on('chat', message => {
        console.log('Chat message received: ' + message);
        handleChat(message);
    });
    
    //Handle disconnection
    socket.on('disconnect', () => {
        console.log('Dropped connection');
    });
    
    //Handle register
    socket.on('register', (username, password) => {
        console.log('Handling register: ' + username + ' ' + password);
        handleRegister(socket, username, password);
    });
    
    //Handle login
    socket.on('login', (username, password) => {
        console.log('Handling login: ' + username + ' ' + password);
        handleLogin(socket, username, password);
    });
    
    //Handle prompt
    socket.on('prompt', prompt => {
        console.log('Handling prompt: ' + prompt);
        handlePrompt(socket, prompt);
    });
    
    //Handle answer
    socket.on('answer', (answer, prompt) => {
        console.log('Handling answer: ' + answer + ' ' + prompt);
        handleAnswer(socket, answer, prompt);
    });
    
    //Handle vote
    socket.on('vote', (answer, prompt) => {
        console.log('Handling vote: ' + answer + ' ' + prompt);
        handleVote(socket, answer, prompt);
    });
    
    //Handle next
    socket.on('next', () => {
        console.log('Handling next');
        handleNext(socket);
    });
    
});

//Start server
if (module === require.main) {
    startServer();
}

module.exports = server;
