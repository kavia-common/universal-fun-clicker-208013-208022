#!/bin/bash
cd /home/kavia/workspace/code-generation/universal-fun-clicker-208013-208022/video_game_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

