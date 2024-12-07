FROM denoland/deno

EXPOSE 8000

USER deno

WORKDIR /app

ADD . /app

RUN deno install --entrypoint main.ts

CMD ["run", "--allow-all",  "main.ts"]
