var socket = null;

//Prepare game
var app = new Vue({
    el: '#game',
    data: {
        error: false,
        connected: false,
        messages: [],
        chatMessage: '',
        // role: 0=admin, 1=player, 2=audience
        // player state: 0=not logged in, 1=logged in/waiting, 2=awaiting prompt input, 3=prompt submitted, 4=awaiting answer input, 5=answer submitted,
        // 6=in audience(cannot answer), 7=awaiting vote input, 8=vote submitted, 9=cannot vote(it's a prompt you answered), 10=waiting(any other state)
        me: { role: '', username: '', state: 0, score: 0 },
        // game state: 0=not started, 1=joining, 2=prompts, 3=answers, 4=voting, 5=results, 6=scores, 7=game over
        state: { state: 0 },
        players: {},
        username: '',
        password: ''
    },
    mounted: function() {
        connect(); 
    },
    methods: {
        handleChat(message) {
            if(this.messages.length + 1 > 10) {
                this.messages.pop();
            }
            this.messages.unshift(message);
        },
        chat() {
            socket.emit('chat',this.chatMessage);
            this.chatMessage = '';
        },
        registerClicked(username, password) {
            socket.emit('register', username, password);
        },
        login(username, password) {
            socket.emit('login', username, password);
        },
        prompt(prompt) {
            socket.emit('prompt', prompt);
        },
        answer(answer, prompt) {
            socket.emit('answer', answer, prompt);
        },
        vote(answer, prompt) {
            socket.emit('vote', answer, prompt);
        },
        next() {
            socket.emit('next');
        },
        update(data) {
            this.me = data.me;
            this.state = data.state;
            this.players = data.players;
        },
        fail(message) {
            console.log('Error: ' + message);
            this.error = message;
            setTimeout(clearError, 3000);
        }
    }
});

function clearError() {
    app.error = null;
}

function connect() {
    //Prepare web socket
    socket = io();
    socket.emit('connection');

    //Connect
    socket.on('connect', function() {
        //Set connected state to true
        app.connected = true;
    });

    //Handle connection error
    socket.on('connect_error', function(message) {
        app.fail('Unable to connect: ' + message);
    });

    //Handle disconnection
    socket.on('disconnect', function() {
        alert('Disconnected');
        app.connected = false;
    });

    //Handle incoming chat message
    socket.on('chat', function(message) {
        app.handleChat(message);
    });

    //Handle update
    socket.on('state', function(data) {
        app.update(data);
    });

}
