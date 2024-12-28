package termutil

type Modes struct {
	ShowCursor            bool
	ApplicationCursorKeys bool
	BlinkingCursor        bool
	ReplaceMode           bool // overwrite character at cursor or insert new
	OriginMode            bool // see DECOM docs - whether cursor is positioned within the margins or not
	LineFeedMode          bool
	ScreenMode            bool // DECSCNM (black on white background)
	AutoWrap              bool
	SixelScrolling        bool // DECSDM
	BracketedPasteMode    bool
}

type MouseMode uint
type MouseExtMode uint

const (
	MouseModeNone MouseMode = iota
	MouseModeX10
	MouseModeVT200
	MouseModeVT200Highlight
	MouseModeButtonEvent
	MouseModeAnyEvent
	MouseExtNone MouseExtMode = iota
	MouseExtUTF
	MouseExtSGR
	MouseExtURXVT
)
