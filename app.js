'use strict';

//Set up express
const express = require('express');
const app = express();

//Setup socket.io
const server = require('http').Server(app);
const io = require('socket.io')(server);
const us = require('underscore');

// set up requests
const axios = require("axios");

//Set up game state
const players = new Map();
const audience = new Map();
const socketsToUsers = new Map();
const usersToSockets = new Map();
let state = {state: 0, submittedPrompts: {}, activePrompts: [], roundPrompts: [],
    answersReceived: {}, votesReceived: {}, currentPrompt: '', promptVotes: {}, roundScores: {}, totalScores: {},
    language: 'en', roundNumber: 0, podium: {}};
const MAX_ROUNDS = 3;

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
const BACKEND_KEY = process.env.BACKEND_KEY || 'test';

// HANDLE REQUESTS
// Start the server
function startServer() {
    const PORT = process.env.PORT || 8080;
    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
        console.log('Press Ctrl+C to quit.');
        console.log('Using backend at: ' + BACKEND_ENDPOINT);
    });
}

// Chat message
function handleChat(name, message) {
    console.log('Handling chat: ' + message);
    io.emit('chat', name, message);
}

//Handle announcements
function announce(message) {
    console.log('Announcement: ' + message);
    io.emit('chat', "Game", message);
}

// send error
function error(socket, message, halt) {
    console.log('Error: ' + message);
    socket.emit('fail', message);
    if(halt) {
        socket.disconnect();
    }
}

// Update state of all users
function updateAll() {
    console.log('Updating all players');
    for(let [_,socket] of usersToSockets) {
        updateUser(socket);
    }
    //update all including display
    const data = {
        state: state,
        players: Object.fromEntries(players),
        audience: Object.fromEntries(audience)
    };
    io.emit('state', data);
}

// Update one user
function updateUser(socket) {
    const username = socketsToUsers.get(socket);
    const isPlayer = players.has(username);
    let theUser;
    if (isPlayer) {
        theUser = players.get(username);
    } else {
        theUser = audience.get(username);
    }
    const data = { me: theUser };
    socket.emit('clientState', data);
}

// Handle joining of players
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
            state.state = 1;
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
        if (response.result === true) {
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
        error(socket, 'Error in login', false);
    }
}

// handle prompt suggestion
async function handleSuggest(socket, keyword) {
    console.log('Handling prompt suggestion: ' + keyword);
    
    const response = await suggestPromptAz(keyword);
    const prompt = response.suggestion;
    console.log('Suggested prompt: ' + prompt);
    socket.emit('suggest', prompt);
}

// handle prompt
async function handlePrompt(socket, prompt) {
    console.log('Handling prompt submission: ' + prompt);
    const username = socketsToUsers.get(socket);
    const isPlayer = players.has(username);
    let user;
    if (isPlayer) {
        user = players.get(username);
    } else {
        user = audience.get(username);
    }
    
    // submit prompt to API
    const response = await createPromptAz(prompt, username);
    if (response.result === true) {
        console.log('Prompt submitted successfully');
    } else {
        console.log('Prompt not submitted');
        error(socket, response.msg, false);
        return;
    }
    
    // check if waiting for prompt in prompts phase, as we can submit whenever in the game
    if (user.state === 2) {
        user.state = 3;
        state.submittedPrompts[username] = prompt;
    } else{
        state.activePrompts.push(prompt);
    }
    updateAll();
}

// handle answer
function handleAnswer(socket, answer, prompt) {
    console.log('Handling answer: ' + answer + ' to prompt: ' + prompt);
    const username = socketsToUsers.get(socket);
    const playerState = players.get(username);
    
    // store answer to prompt
    if (state.answersReceived.hasOwnProperty(prompt)) {
        state.answersReceived[prompt].push({answer: answer, username: username});
    } else {
        state.answersReceived[prompt] = [{answer: answer, username: username}];
    }
    
    // check if player has more prompts to answer
    if (playerState.prompts.length !== 0) {
        playerState.prompt = playerState.prompts.pop();
    } else {
        playerState.prompt = ''
        playerState.state = 5;
    }
    updateAll();
}

// handle vote
function handleVote(socket, answer, prompt) {
    console.log('Handling vote to: ' + answer + ' for prompt: ' + prompt);
    const username = socketsToUsers.get(socket);
    const isPlayer = players.has(username);
    const user = isPlayer ? players.get(username) : audience.get(username);
    user.state = 8;
    
    // add vote to prompt and answer
    if (state.votesReceived.hasOwnProperty(prompt)) {
        state.votesReceived[prompt].push(answer);
    } else {
        state.votesReceived[prompt] = [answer];
    }
    updateAll();
}

function allVotesIn() {
    for (let [_, player] of players) {
        if (player.state < 8) {
            return false;
        }
    }
    for (let [_, member] of audience) {
        if (member.state < 8) {
            return false;
        }
    }
    return true;
}

// handle next
async function handleNext(socket) {
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
            if (allPromptsSubmitted(socket)) {
                console.log('Prompts phase over, starting answers');
                await endPrompts();
                startAnswers();
                state.state++;
                updateAll();
            }
            break;
        case 3:
            if (endAnswers(socket)) {
                console.log('Answers phase over, starting votes');
                state.state++;
                startVotes();
                updateAll();
            }
            break;
        case 4:
            if (endVotes(socket)) {
                console.log('Votes phase over, showing prompt scores');
                state.state++;
                updateAll();
            }
            break;
        case 5:
            if (endPromptResults()) {
                console.log('Prompt Scores phase over, starting scores');
                startTotalScores();
                state.state++;
            } else {
                //return to voting phase on next prompt
                console.log('Prompt Scores phase over, starting votes for next prompt');
                state.state = 4;
                startVotes();
            }
            updateAll();
            break;
        case 6:
            console.log('Total Scores phase over, ending game');
            if (endTotalScores()) {
                state.state++;
                await endGame();
            } else {
                //there's more rounds to play
                state.roundNumber++;
                state.state = 3;
                startAnswers();
            }
            updateAll();
            break;
    }
}


// GAME TRANSITIONS LOGIC
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

function allPromptsSubmitted(socket) {
    // check if every player has submitted a prompt
    console.log("checking if all players have submitted a prompt")
    for (let [_, player] of players) {
        if (player.state < 3) {
            console.log('Cannot advance: Not all players have submitted a prompt');
            error(socket, 'Not all players have submitted a prompt', false);
            return false;
        }
    }
    return true;
}

// end prompts
async function endPrompts() {
    // initialize the active prompts
    let numPrompts = 3 * (players.size % 2 === 0 ? players.size / 2
        : players.size);
    let promptsGame = Object.values(state.submittedPrompts);
    const apiPrompts = await getAPIPrompts();
    let promptsApi = apiPrompts.filter(prompt => !promptsGame.includes(prompt));
    promptsApi = [... new Set(promptsApi)];
    
    // try to get equal number of prompts from API and game submitted
    if (promptsApi.length > numPrompts / 2 && promptsGame.length > numPrompts
        / 2) {
        promptsGame = promptsGame.slice(0, numPrompts / 2);
        promptsApi = promptsApi.slice(0, numPrompts / 2);
        state.activePrompts = promptsGame.concat(promptsApi);
    } else if (promptsApi.length > numPrompts / 2) {
        numPrompts -= promptsGame.length;
        promptsApi = promptsApi.slice(0, numPrompts);
        state.activePrompts = promptsGame.concat(promptsApi);
    } else if (promptsGame.length > numPrompts / 2) {
        numPrompts -= promptsApi.length;
        promptsGame = promptsGame.slice(0, numPrompts);
        state.activePrompts = promptsGame.concat(promptsApi);
    } else {
        state.activePrompts = promptsGame.concat(promptsApi);
    }
    state.activePrompts = us.shuffle(state.activePrompts);
}

// start answers
function startAnswers() {
    // set user states 4:players, 6:audience
    for (let [_, player] of players) {
        player.state = 4;
    }
    for (let [_, member] of audience) {
        member.state = 6;
    }
    
    // assign prompts to players
    const evenPlayers = players.size % 2 === 0;
    if (evenPlayers) {
        // assign 1 prompt per player, 2 players per prompt
        const availablePrompt = [];
        for (let [_, player] of players) {
            if (availablePrompt.length === 0) {
                const prompt = state.activePrompts.pop();
                state.roundPrompts.push(prompt);
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
    for (let [_, player] of players) {
        player.prompt = player.prompts.pop();
    }
}

// end answers
function endAnswers(socket) {
    //check if every player has answered
    for (let [_, player] of players) {
        if (player.state !== 5) {
            error(socket, 'Not all players have answered', false);
            return false;
        }
    }
    return true;
}

// start votes
function startVotes() {
    state.currentPrompt = state.roundPrompts.pop();
    const playersWhoAnswered = state.answersReceived[state.currentPrompt].map(answer => answer.username);
    for (let [username, player] of players) {
        if (playersWhoAnswered.includes(username)) {
            player.state = 9; //cannot vote
        } else {
            player.state = 7;
        }
    }
    for (let [_, member] of audience) {
        member.state = 7;
    }
}

// end votes
function endVotes(socket) {
    // check if all votes are in
    if (!allVotesIn()) {
        error(socket, 'Not all votes are in', false);
        return false;
    }
    console.log('Ending voting phase for this prompt');
    if (state.roundScores[state.roundNumber] === undefined) {
        state.roundScores[state.roundNumber] = {};
    }
    
    //start calculating scores
    const playerVotes = {};
    const playersWhoAnswered = state.answersReceived[state.currentPrompt].map(answer => answer.username);
    for (const player of playersWhoAnswered) {
        playerVotes[player] = 0;
    }
    
    // count votes
    const answers = state.votesReceived[state.currentPrompt];
    answers.forEach(answer => {
        const username = state.answersReceived[state.currentPrompt].find(ans => ans.answer === answer).username;
        playerVotes[username]++;
    });
    
    state.promptVotes = playerVotes;
    
    // calculate scores for this prompt
    for (const player in playerVotes) {
        const score = playerVotes[player] * state.roundNumber * 100;
        
        if (state.roundScores[state.roundNumber][player] === undefined) {
            state.roundScores[state.roundNumber][player] = 0;
        }
        state.roundScores[state.roundNumber][player] += score;
    }
    
    return true;
}

// end results
function endPromptResults() {
    // check if all prompts have been voted on
    return state.roundPrompts.length === 0;
    
}

// start scores
function startTotalScores() {
    // calculate total scores
    for (const player in state.roundScores[state.roundNumber]) {
        if (state.totalScores[player] === undefined) {
            state.totalScores[player] = 0;
        }
        const score = state.roundScores[state.roundNumber][player];
        state.totalScores[player] += score;
    }
}

// end scores
function endTotalScores() {
    //check if all rounds are over
    return state.roundNumber === MAX_ROUNDS;
}

// end game
async function endGame() {
    //update players in cloud server
    for (let [username, _] of players) {
        const response = await updatePlayerAz(username, 1, state.totalScores[username]);
        console.log('Player ' + username + ' update response:' + response);
        if (response.result === true) {
            console.log('Player updated successfully');
        } else {
            console.log('Player not updated');
        }
    }
    
    //get global podium
    const response = await podiumAz();
    console.log('Podium response:' + response);
    state.podium = response;
}

// reset game
function resetGame() {
    console.log('Resetting game state');
    state = {state: 1, submittedPrompts: {}, activePrompts: [], roundPrompts: [],
        answersReceived: {}, votesReceived: {}, currentPrompt: '', promptVotes: {}, roundScores: {}, totalScores: {},
        language: 'en', roundNumber: 0, podium: {}};
    for (let [_, player] of players) {
        player.state = 1;
        player.score = 0;
        player.prompts = [];
        player.prompt = '';
    }
    for (let [_, member] of audience) {
        member.state = 0;
        member.score = 0;
        member.prompts = [];
        member.prompt = '';
    }
}


// AZURE FUNCTIONS
// main function to call Azure functions
async function callAzureFunction(endpoint, method, data={}) {
    try {
        let response = await axios.request({
            url: `${BACKEND_ENDPOINT}${endpoint}`,
            method: method,
            data: data,
            headers: {
                'x-functions-key': BACKEND_KEY,
                'Content-Type': 'application/json'
            }
        });
        console.log("Response from Azure function: ", response.data);
        return response.data;
    } catch (e) {
        console.error("Error in calling Azure function: ", e);
        return e.response.data;
    }
}

// get prompts from API
async function getAPIPrompts() {
    const prompts = [];
    const usernames = Array.from(players.keys());
    const response = await getUtilsAz(usernames, state.language);
    for (const entry of response) {
        prompts.push(entry.text);
    }
    return prompts;
}

// dedicated functions for Azure functions
function registerPlayerAz(username, password) {
    return callAzureFunction('/player/register', 'post', {username, password});
}

function loginPlayerAz(username, password) {
    return callAzureFunction('/player/login', 'get', {username, password});
}

function updatePlayerAz(username, add_to_games_played, add_to_score) {
    return callAzureFunction('/player/update', 'put', {username, add_to_games_played, add_to_score});
}

function createPromptAz(text, username) {
    return callAzureFunction('/prompt/create', 'post', {text, username});
}

function deletePromptAz(username) {
    return callAzureFunction('/prompt/delete', 'post', {username});
}

function suggestPromptAz(keyword) {
    return callAzureFunction('/prompt/suggest', 'post', {keyword});
}

function getUtilsAz(players, language) {
    return callAzureFunction('/utils/get', 'get', {players, language});
}

function podiumAz() {
    return callAzureFunction('/utils/podium', 'get');
}

//Handle new connection
io.on('connection', socket => {
    console.log('New connection');
    
    //Handle on chat message received
    socket.on('chat', message => {
        console.log('Chat message received: ' + message);
        const username = socketsToUsers.get(socket);
        handleChat(username, message);
    });
    
    //Handle disconnection
    socket.on('disconnect', () => {
        console.log('Dropped connection: ' + socketsToUsers.get(socket));
        //Remove user from game
        const username = socketsToUsers.get(socket);
        socketsToUsers.delete(socket);
        usersToSockets.delete(username);
        if (players.has(username)) {
            const player = players.get(username);
            players.delete(username);
            if (player.role === 0) { //if admin disconnects, assign new admin
                try {
                    const [nextUsername, nextPlayer] = players.entries().next().value;
                    nextPlayer.role = 0;
                    players.set(nextUsername, nextPlayer);
                    console.log('New admin: ' + nextUsername);
                } catch (e) {
                    console.log('No more players');
                }
            }
        }
        if (audience.has(username)) {
            audience.delete(username);
        }
        // reset game if no players left
        if (players.size === 0) {
            resetGame();
        }
        updateAll();
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
    
    // Handle suggest prompt
    socket.on('suggest', keyword => {
        console.log('Handling suggest: ' + keyword);
        handleSuggest(socket, keyword);
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
    
    //Handle reset
    socket.on('reset', () => {
        console.log('Handling reset');
        resetGame();
        updateAll();
    });
});

//Start server
if (module === require.main) {
    startServer();
}

module.exports = server;
