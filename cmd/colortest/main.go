package main

import (
	"fmt"
	"os"
	"os/signal"
)

func main() {
	// Print system colors (0-15)
	fmt.Println("System colors (0-15):")
	for i := 0; i < 16; i++ {
		if i > 0 && i%8 == 0 {
			fmt.Println()
		}
		fmt.Printf("\033[38;5;%dm%4d\033[0m ", i, i)
	}

	// Print color cube (16-231)
	fmt.Println("Color cube (16-231):")
	for i := 16; i < 232; i++ {
		if (i-16)%6 == 0 && i != 16 {
			fmt.Println()
		}
		if (i-16)%36 == 0 && i != 16 {
			fmt.Println()
		}
		fmt.Printf("\033[38;5;%dm%4d\033[0m ", i, i)
	}
	// fmt.Println("\n")
	//
	// // Print grayscale (232-255)
	// fmt.Println("Grayscale (232-255):")
	// for i := 232; i < 256; i++ {
	// 	if (i-232)%8 == 0 && i != 232 {
	// 		fmt.Println()
	// 	}
	// 	fmt.Printf("\033[38;5;%dm%4d\033[0m ", i, i)
	// }
	// fmt.Println("\n")

	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt)
	<-c
}
