# ARIA-public

Start instructions:

1) cd aria-app
2) npm install
3) npx expo start.

This project has been configured using windows. API keys are obtained through the following environment variables:
const EXPO_PUBLIC_ASI_ONE_API_KEY = process.env.EXPO_PUBLIC_ASI_ONE_API_KEY;
const EXPO_PUBLIC_OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
in ./aria-app/server/node-server-interface.ts at the top of the document. Modify as necessary.

App operation instructions:
hold the "record" icon to send a message to ARIA. release to get a response.



