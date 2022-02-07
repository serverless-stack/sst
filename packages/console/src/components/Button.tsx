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
      xs: {
        height: 25,
        padding: "0 $md",
        fontSize: "$sm",
      },
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
      info: {
        background: "$blue5",
        color: "$blue10",
        "&:hover": {
          background: "$blue4",
        },
      },
      accent: {
        background: "$accent",
        border: "1px solid $border",
        color: "$hiContrast",
        "&:hover": {
          background: "$gray2",
        },
      },
      danger: {
        background: "$red5",
        color: "$red10",
        "&:hover": {
          background: "$red4",
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
