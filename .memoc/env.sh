# Source this from the project root to put the local memoc wrapper first in PATH.
MEMOC_DIR="$PWD/.memoc"
case ":$PATH:" in
  *":$MEMOC_DIR/bin:"*) ;;
  *) PATH="$MEMOC_DIR/bin:$PATH"; export PATH ;;
esac
