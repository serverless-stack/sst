local opts = { noremap = true, silent = true }

vim.keymap.set("n", "<leader>tb", function()
	vim.cmd("!go build -o ./dist/sst ./cmd/sst && ./dist/sst")
end, opts)
