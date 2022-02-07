import { styled } from "~/stitches.config";

export const Button = styled("button", {
  border: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  userSelect: "none",
  background: "transparent",
  cursor: "initial",
  fontFamily: "$sans",
  fontWeight: 600,
  borderRadius: 4,
  "&:active": {
    transform: "translateY(1px)",
  },
  variants: {
    size: {
      sm: {
        height: 36,
        padding: "0 $lg",
        fontSize: "$sm",
      },
      md: {
        height: 42,
        padding: "0 $lg",
        fontSize: "$md",
      },
    },
    color: {
      accent: {
        background: "$accent",
        border: "1px solid $border",
        color: "$hiContrast",
        "&:hover": {
          background: "$gray2",
        },
      },
      highlight: {
        background: "$highlight",
        color: "white",
        "&:hover": {
          opacity: 0.9,
        },
      },
      ghost: {
        background: "transparent",
        color: "$highlight",
      },
    },
  },
  defaultVariants: {
    color: "highlight",
    size: "sm",
  },
});
