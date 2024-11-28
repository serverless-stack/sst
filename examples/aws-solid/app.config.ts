import { defineConfig } from '@solidjs/start/config'

export default defineConfig({
  server: {
    compatibilityDate: '2024-11-05',
    preset: 'aws-lambda',
    awsLambda: {
      streaming: true,
    },
  },
});
