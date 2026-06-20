# Records assets/demo.gif. Render with charmbracelet/vhs:
#   npm run build        # demo.mjs imports from dist/
#   vhs demo.tape        # writes assets/demo.gif
# Install vhs: https://github.com/charmbracelet/vhs
Output assets/demo.gif

Set FontSize 16
Set Width 1000
Set Height 660
Set Theme "Dracula"
Set TypingSpeed 45ms
Set Padding 20

Type "node scripts/demo.mjs"
Sleep 500ms
Enter
Sleep 8s
