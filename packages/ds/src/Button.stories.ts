import type { Meta, StoryObj } from "@storybook/html";

interface ButtonArgs {
  label: string;
  primary?: boolean;
  onClick?: () => void;
}

const meta: Meta<ButtonArgs> = {
  title: "Universal/Button",
  tags: ["autodocs"],
  render: (args: ButtonArgs) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerText = args.label;
    btn.className = args.primary ? "refarm-btn refarm-btn-primary" : "refarm-btn";
    
    if (args.onClick) {
      btn.addEventListener("click", args.onClick);
    }

    return btn;
  },
  argTypes: {
    label: { control: "text" },
    primary: { control: "boolean" },
    onClick: { action: "onClick" },
  },
  parameters: {
    // Optional Figma integration placeholder
    design: {
      type: "figma",
      url: "https://www.figma.com/file/placeholder-refarm-design-system",
    },
  },
};

export default meta;

export const Primary: StoryObj<ButtonArgs> = {
  args: {
    primary: true,
    label: "Initialize Machinery",
  },
};

export const Secondary: StoryObj<ButtonArgs> = {
  args: {
    label: "Cancel Run",
  },
};

export const KeyboardNavigable: StoryObj<ButtonArgs> = {
  args: {
    label: "Focus Me (Tab)",
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    // This demonstrates the focus-visible style
    const button = canvasElement.querySelector('button');
    button?.focus();
  },
};
