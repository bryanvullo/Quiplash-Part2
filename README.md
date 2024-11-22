It is a simple chat application written in Javascript, using the Express server framework, VueJS and Socket.IO.

## Running

### Locally

Start the application using:
```
$ npm run start
```

### Deploying to the cloud

To deploy the application to Google App Engine, run:
```
$ npm run gdeploy
```

To stop the deployment, run:
```
$ gcloud app versions stop test
```

To access the deployed application, run:
```
$ gcloud app browse
```

### For Bryan
to init GAE:
```
$ gcloud init
```
and select the project.

