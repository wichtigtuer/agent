# Development makefile — manages containers against the locally built image
# (wichtigtuer-agent:latest). All targets (help, pull, run, setup, pi, shell,
# stop) are defined in dist/Makefile, the distributed release asset — edit
# them there, never here. These overrides point the targets at the local
# image and skip the registry pull:
IMAGE := wichtigtuer-agent:latest
SKIP_PULL := 1

include dist/Makefile
