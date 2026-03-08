import type { Preview } from "@storybook/html";
import "../src/styles.css";
import "../src/tokens.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#0d1117' },
        { name: 'light', value: '#ffffff' },
      ],
    },
    a11y: {
      element: '#storybook-root',
      config: {},
      options: {},
      manual: true,
    },
  },
};

export default preview;
