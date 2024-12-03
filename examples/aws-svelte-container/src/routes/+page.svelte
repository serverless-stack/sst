<script>
  /** @type {import('./$types').PageData} */
  export let data;

  const handleSubmit = async (e) => {
    const formData = new FormData(e.target);
    const file = formData.get("file");

    const image = await fetch(data.url, {
      body: file,
      method: "PUT",
      headers: {
        "Content-Type": file.type,
        "Content-Disposition": `attachment; filename="${file.name}"`,
      },
    });

    window.location.href = image.url.split("?")[0];
  };
</script>

<style>
  section {
    flex: 0.6;
    display: flex;
    padding-top: 4rem;
    align-items: center;
    flex-direction: column;
    justify-content: center;
  }
</style>

<section>
  <form on:submit|preventDefault={handleSubmit}>
    <input name="file" type="file" accept="image/png, image/jpeg" />
    <button type="submit">Upload</button>
  </form>
</section>
