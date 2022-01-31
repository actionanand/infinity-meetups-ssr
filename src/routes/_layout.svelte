<script>
  import Header from '../components/UI/Header.svelte';

	// export let segment;

  let appName = 'infinity meetups';
</script>

<style>
  main {
    margin-top: 5rem;
  }
</style>

<Header {appName} />

<main>
	<slot></slot>
</main>