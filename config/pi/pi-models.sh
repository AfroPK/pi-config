#!/usr/bin/env bash
# Pi Agent Multi-Model Launcher
# Usage: pi-models [model] [pi args...]
#   coding   - Use Qwen 2.5 Coder 7B (default, code generation)
#   vision   - Use Gemma 4 12B QAT (image analysis)
#   reason   - Use DeepSeek R1 Distill Qwen 7B (reasoning/planning)

PI_CMD="pi"
case "${1:-}" in
  coding)
    shift
    exec $PI_CMD --model qwen2.5-coder-7b-instruct "$@"
    ;;
  vision)
    shift
    exec $PI_CMD --model google/gemma-4-12b-qat "$@"
    ;;
  reason)
    shift
    exec $PI_CMD --model deepseek-r1-distill-qwen-7b --thinking high "$@"
    ;;
  *)
    # Default: use configured default model
    exec $PI_CMD "$@"
    ;;
esac
