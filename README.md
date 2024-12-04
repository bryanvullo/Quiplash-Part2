# Quiplash by Bryan Vullo
Welcome to Quiplash! This is a simple web application that allows users to join to play a game of Quiplash. \
There are a maximum number of 8 players per game, but additional users can still play as audience members. \
There are three rounds per game. In each round, players are given a prompt and must come up with a funny response. \
A display screen must be used to show the prompts, responses and leaderboard to all players. 

The game can be played by following the links: \
[Display](https://quiplash-442521.nw.r.appspot.com/display) \
[Players](https://quiplash-442521.nw.r.appspot.com/)

---

## Additional Features  extended from the Specification
- Admin can reset the game once a game is over (in the final leaderboard screen)
- If all players disconnect, the game will be reset automatically
- Players can use the AI prompt suggestion feature by submitting a keyword (only in prompt suggestion phase).
- Instead of registering and then logging in, users can directly register and login in one step.

## Technologies
It is a simple application written in Javascript, using the Express server framework, VueJS and Socket.IO hosted on Google App Engine.
It also uses a backend cloud database and functions hosted on Azure.

## Running

### Locally

Start the application using:
`$ npm start`

The application can be accessed at: \
Display: `http://localhost:8080/display` \
Players: `http://localhost:8080/`

### Deploying to the cloud

Firstly, log into GAE by executing:
`$ gcloud init`
and select the project.

To deploy the application to Google App Engine, run: \
`$ npm run gdeploy`

To list the deployed versions, run: \
`$ gcloud app versions list`

To stop the deployment, run: \
`$ npm run gstop`

To access the deployed application, run: \
`$ npm run gbrowse`